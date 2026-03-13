import { transformToExtractionPattern } from '@bemodest/utils/regex';
import {
    WS_STATUS_DISCONNECTED,
    WS_STATUS_ERROR
} from '../shared/constants';

const NAMESPACE_HELPERS: Record<string, string> = {
    'eip155': 'Numeric Chain ID for EVM (e.g. 1, 137)',
    'cosmos': 'Cosmos Chain ID (e.g. cosmoshub-4, osmosis-1)',
    'solana': 'Solana truncated genesis hash (32 chars)',
    'polkadot': 'Polkadot genesis hash (32 chars lowercase hex)',
    'bip122': 'Bitcoin Genesis Block Hash',
    'others': 'Manual CAIP-2 (e.g. massa:mainnet)'
};

const NAMESPACE_REGEX: Record<string, RegExp> = {
    'eip155': /^\d+$/,
    'cosmos': /^[a-zA-Z0-9._-]{1,47}$/,
    'solana': /^[1-9A-HJ-NP-Za-km-z]{32}$/,
    'polkadot': /^[0-9a-f]{32}$/,
    'bip122': /^[a-fA-F0-9]{64}$/,
    'others': /^[a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/
};

export class Chains {
    private statusDiv: HTMLElement | null;
    private annotations: Record<string, string> = {};
    private rpcs: string[] = [];
    private wsRpcs: string[] = [];

    constructor() {
        this.statusDiv = document.getElementById('status');
        this.setupMessageListener();
        this.fetchDataFromServer();
        this.setupFilterHandler();
    }

    /**
     * Gets the current internal state of the chain form (annotations, rpcs, wsRpcs).
     * Used for form draft preservation.
     */
    public getInternalState() {
        return {
            annotations: this.annotations,
            rpcs: this.rpcs,
            wsRpcs: this.wsRpcs
        };
    }

    /**
     * Sets the internal state of the chain form and re-renders the UI components.
     * Used for form draft restoration.
     */
    public setInternalState(state: { annotations?: Record<string, string>, rpcs?: string[], wsRpcs?: string[] }) {
        if (state.annotations) {
            this.annotations = { ...state.annotations };
            this.renderAnnotations();
        }
        if (state.rpcs) {
            this.rpcs = [...state.rpcs];
            this.renderRpcs();
        }
        if (state.wsRpcs) {
            this.wsRpcs = [...state.wsRpcs];
            this.renderWsRpcs();
        }
    }

    private updateStatus(message: string, type: 'info' | 'success' | 'error' | 'pending' = 'info') {
        if (!this.statusDiv) return;
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status ${type}`;
        this.statusDiv.style.display = 'block';

        if (type !== 'pending') {
            setTimeout(() => {
                if (this.statusDiv) this.statusDiv.style.display = 'none';
            }, 3000);
        }
    }

    private setupMessageListener(): void {
        chrome.runtime.onMessage.addListener((message: any) => {
            if (message.type === 'ws-event') {
                this.handleWebSocketEvent(message.event, message.data);
            }
        });
    }

    private handleWebSocketEvent(event: string, data: any): void {
        switch (event) {
            case 'chainUpdate':
                if (data.success && data.data) {
                    this.renderChainList(data.data);
                }
                break;
            case 'WS_EVENT_FAILURE':
                if (data.error) {
                    this.updateStatus(`Error: ${data.error}`, 'error');
                }
                break;
        }
    }

    async fetchDataFromServer() {
        // Request chain data via background script
        chrome.runtime.sendMessage({
            action: 'ws-emit',
            event: 'chainGet',
            payload: { params: {} }
        });
    }

    async addDataToServer(data: any): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'ws-emit',
                event: 'chainInsert',
                payload: { body: data } // Corrected to match ChainInsertSchema
            });
            resolve(true);
        });
    }

    async updateDataToServer(data: any, id: string): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'ws-emit',
                event: 'chainUpdate',
                payload: { body: { ...data, _id: id } }
            });
            resolve(true);
        });
    }

    async deleteDataToServer(name: string): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'ws-emit',
                event: 'chainDelete',
                payload: { body: { name } }
            });
            resolve(true);
        });
    }

    renderChainList(chains: any[], query: string = "") {
        // Corrected ID from 'chains-list-container' to 'ext-chain-list-container'
        const container = document.getElementById('ext-chain-list-container');
        if (!container) {
            console.error('Chain list container not found!');
            return;
        }

        container.innerHTML = '';

        if (query !== "") {
            chains = chains.filter((chain: any) =>
                chain.name.toLowerCase().includes(query.toLowerCase()) ||
                (chain.code && chain.code.toLowerCase().includes(query.toLowerCase()))
            );
        }

        const countEl = document.getElementById('chain-count');
        if (countEl) {
            countEl.textContent = chains.length.toString();
        }

        if (chains.length === 0) {
            container.innerHTML = '<div style="padding: 10px; color: #666; font-style: italic;">No chains found. Add one above.</div>';
            return;
        }

        chains.forEach((chain: any) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '8px';
            row.style.borderBottom = '1px solid #eee';
            row.style.backgroundColor = '#fff';

            // Preview square (border-radius: 4px)
            const preview = document.createElement('div');
            preview.style.width = '24px';
            preview.style.height = '24px';
            preview.style.borderRadius = '4px';
            preview.style.background = chain.bgColor;
            preview.style.color = chain.fontColor;
            preview.style.display = 'flex';
            preview.style.alignItems = 'center';
            preview.style.justifyContent = 'center';
            preview.style.marginRight = '10px';
            preview.style.fontSize = '10px';
            preview.style.fontWeight = 'bold';

            // Backend now normalizes code, but keep fallback
            const displayCode = chain.annotation?.code || '?';
            preview.textContent = displayCode.substring(0, 1).toUpperCase();

            const infoDiv = document.createElement('div');
            infoDiv.style.flex = '1';

            // Display deprecation warning
            let deprecationBadge = '';
            if (chain.status === 'deprecated') {
                deprecationBadge = ' <span style="color: red; font-size: 10px; font-weight: bold; border: 1px solid red; border-radius: 3px; padding: 1px 3px; margin-left: 5px;">[DEPRECATED]</span>';
                row.style.opacity = '0.6';
            }

            const nameEl = document.createElement('div');
            nameEl.style.fontWeight = '500';
            nameEl.style.fontSize = '13px';
            nameEl.innerHTML = `${chain.name} (${displayCode})${deprecationBadge}`;

            const detailsEl = document.createElement('div');
            detailsEl.style.fontSize = '11px';
            detailsEl.style.color = '#666';

            // Show label usage count
            const usageText = chain.labelCount !== undefined ? `Labels: ${chain.labelCount}` : '';
            const regexText = `Regex: ${chain.addrRegexPatterns?.length || 0}`;

            let supersededText = '';
            if (chain.status === 'deprecated' && chain.supersededBy) {
                supersededText = `<br/><span style="color: #d97706;">Superseded by: ${chain.supersededBy}</span>`;
            }

            detailsEl.innerHTML = `${regexText} | ${usageText}${supersededText}`;

            infoDiv.appendChild(nameEl);
            infoDiv.appendChild(detailsEl);

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.className = 'btn btn-sm btn-error';
            delBtn.style.padding = '0 6px';
            delBtn.style.height = '24px';
            delBtn.onclick = async (e) => {
                e.stopPropagation();

                // Disallow direct deletion of Cosmos chains per Phase 6 governance
                if (chain.caip2 && chain.caip2.startsWith('cosmos:')) {
                    alert(`Cosmos chains cannot be deleted. Please update the chain to set status: 'deprecated' and provide a supersededBy CAIP-2 ID.`);
                    return;
                }

                const labelCount = chain.labelCount || 0;
                if (labelCount > 0) {
                    alert(`Cannot delete chain "${chain.name}". ${labelCount} label(s) are using this chain.`);
                    return;
                }
                if (confirm(`Are you sure you want to delete chain "${chain.name}"?`)) {
                    await this.deleteDataToServer(chain.name);
                }
            };

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.alignItems = 'center';
            leftSide.appendChild(preview);
            leftSide.appendChild(infoDiv);

            row.appendChild(leftSide);
            row.appendChild(delBtn);

            // Make row clickable to edit
            row.style.cursor = 'pointer';
            row.onclick = () => {
                this.populateForm(chain);
                // Visual feedback for selected row
                Array.from(container.children).forEach(r => (r as HTMLElement).style.backgroundColor = '#fff');
                row.style.backgroundColor = '#f0f9ff';
            };
            row.appendChild(delBtn);
            container.appendChild(row);
        });
    }

    populateForm(chain: any): void {
        const form = document.getElementById('form-add-chains') as HTMLFormElement;
        if (!form) return;

        // Store editing ID
        form.dataset.editingId = String(chain._id);

        // Update Title
        const titleEl = document.getElementById('chain-form-title');
        if (titleEl) titleEl.textContent = 'Edit Chain';

        // Populate fields
        (document.getElementById('chain-name') as HTMLInputElement).value = chain.name;

        // Handle CAIP-2 split
        const nsSelect = document.getElementById('chain-namespace') as HTMLSelectElement;
        const refInput = document.getElementById('chain-reference') as HTMLInputElement;

        if (chain.caip2) {
            const hasSeparator = chain.caip2.includes(':');
            const [namespace, reference] = hasSeparator ? chain.caip2.split(':') : ['', chain.caip2];
            const standardNamespaces = ['eip155', 'cosmos', 'solana', 'bip122'];

            if (hasSeparator && standardNamespaces.includes(namespace)) {
                if (nsSelect) {
                    nsSelect.value = namespace;
                    nsSelect.dispatchEvent(new Event('change'));
                }
                if (refInput) refInput.value = reference;
            } else {
                // Handle 'others' case or non-prefixed CAIP2 (like legacy data)
                if (nsSelect) {
                    nsSelect.value = 'others';
                    nsSelect.dispatchEvent(new Event('change'));
                }
                if (refInput) refInput.value = chain.caip2;
            }
        }

        // Symbol (formerly Badge Code)
        const symbolInput = document.getElementById('chain-symbol') as HTMLInputElement;
        if (symbolInput) symbolInput.value = chain.symbol || '';

        // Advanced Settings
        (document.getElementById('chain-is-testnet') as HTMLInputElement).checked = chain.isTestnet || false;
        const gasInput = document.getElementById('chain-gas-price') as HTMLInputElement;
        if (gasInput) gasInput.value = chain.gasPriceGwei != null ? String(chain.gasPriceGwei) : '';

        const blockTimeInput = document.getElementById('chain-block-time') as HTMLInputElement;
        if (blockTimeInput) blockTimeInput.value = chain.block_time != null ? String(chain.block_time) : '30';

        const prefixInput = document.getElementById('chain-explorer-prefix') as HTMLInputElement;
        if (prefixInput) prefixInput.value = chain.blockExplorerPrefix || '';

        this.rpcs = [...(chain.rpc || [])];
        this.wsRpcs = [...(chain.wsRpc || [])];
        this.renderRpcs();
        this.renderWsRpcs();

        // Annotations
        this.annotations = { ...(chain.annotation || {}) };
        this.renderAnnotations();

        const supersededInput = document.getElementById('chain-superseded-by') as HTMLInputElement;
        if (supersededInput) supersededInput.value = chain.supersededBy || '';

        this.toggleSupersededByVisibility();

        // Populate regex (join array with newlines for textarea)
        const regexInput = document.getElementById('chain-regex') as HTMLTextAreaElement;
        if (chain.addrRegexPatterns && chain.addrRegexPatterns.length > 0) {
            regexInput.value = chain.addrRegexPatterns.join('\n');
        } else {
            regexInput.value = '';
        }

        // Set case sensitive
        (document.getElementById('chain-case-sensitive') as HTMLInputElement).checked = chain.addrCaseSensitive || false;

        const memoRequiredInput = document.getElementById('chain-memo-required') as HTMLInputElement;
        if (memoRequiredInput) {
            memoRequiredInput.checked = chain.memoRequired || false;
            memoRequiredInput.dispatchEvent(new Event('change'));
        }

        const memoRegexInput = document.getElementById('chain-memo-regex') as HTMLTextAreaElement;
        if (memoRegexInput) {
            if (chain.memoRegexPatterns && chain.memoRegexPatterns.length > 0) {
                memoRegexInput.value = chain.memoRegexPatterns.join('\n');
            } else {
                memoRegexInput.value = '';
            }
        }

        // Set font color
        const fontSelect = document.getElementById('chain-font-color') as HTMLSelectElement;
        fontSelect.value = chain.fontColor || '#EFEFEF';

        // Parse and set background color
        const bgColor = chain.bgColor || '#3b82f6';
        const startPick = document.getElementById('chain-bgcolor-start') as HTMLInputElement;
        const midPick = document.getElementById('chain-bgcolor-mid') as HTMLInputElement;
        const endPick = document.getElementById('chain-bgcolor-end') as HTMLInputElement;
        const bgTypeRadios = document.getElementsByName('bgType') as NodeListOf<HTMLInputElement>;

        if (bgColor.includes('gradient')) {
            // Extract hex colors from gradient
            const hexColors = bgColor.split(',').map((c: string) => c.trim().replace(/\)$/, '')).filter((c: string) => c.startsWith('#'));

            if (hexColors.length >= 3) {
                startPick.value = hexColors[0];
                midPick.value = hexColors[1];
                endPick.value = hexColors[2];
                Array.from(bgTypeRadios).find(r => r.value === 'gradient3')!.checked = true;
            } else if (hexColors.length === 2) {
                startPick.value = hexColors[0];
                endPick.value = hexColors[1];
                Array.from(bgTypeRadios).find(r => r.value === 'gradient2')!.checked = true;
            } else {
                startPick.value = '#3b82f6';
                Array.from(bgTypeRadios).find(r => r.value === 'single')!.checked = true;
            }
        } else {
            startPick.value = bgColor;
            Array.from(bgTypeRadios).find(r => r.value === 'single')!.checked = true;
        }

        // Trigger preview update
        startPick.dispatchEvent(new Event('input'));

        // Update button text
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (submitBtn) {
            submitBtn.textContent = 'Update Chain';
        }

        // Add cancel button if not exists
        let cancelBtn = document.getElementById('btn-cancel-edit') as HTMLButtonElement;
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'btn-cancel-edit';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.className = 'btn btn-sm btn-ghost ml-2';
            cancelBtn.onclick = (e) => {
                e.preventDefault();
                this.resetForm();
            };
            submitBtn?.parentElement?.appendChild(cancelBtn);
        }
    }

    resetForm(): void {
        const form = document.getElementById('form-add-chains') as HTMLFormElement;
        if (!form) return;

        delete form.dataset.editingId;
        form.reset();

        // Reset Title
        const titleEl = document.getElementById('chain-form-title');
        if (titleEl) titleEl.textContent = 'New Chain';

        // Reset Annotations & RPCs
        this.annotations = {};
        this.rpcs = [];
        this.wsRpcs = [];
        this.renderAnnotations();
        this.renderRpcs();
        this.renderWsRpcs();

        // Reset color picker to default
        const startPick = document.getElementById('chain-bgcolor-start') as HTMLInputElement;
        const bgTypeRadios = document.getElementsByName('bgType') as NodeListOf<HTMLInputElement>;
        Array.from(bgTypeRadios).find(r => r.value === 'single')!.checked = true;
        startPick.value = '#3b82f6';
        startPick.dispatchEvent(new Event('input'));

        // Reset button text
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (submitBtn) {
            submitBtn.textContent = 'Save Chain';
        }

        // Reset status & supersededBy
        const statusSelect = document.getElementById('chain-status') as HTMLSelectElement;
        if (statusSelect) statusSelect.value = 'active';

        const supersededInput = document.getElementById('chain-superseded-by') as HTMLInputElement;
        if (supersededInput) supersededInput.value = '';

        const nsSelect = document.getElementById('chain-namespace') as HTMLSelectElement;
        if (nsSelect) {
            nsSelect.value = 'eip155';
            nsSelect.dispatchEvent(new Event('change'));
        }

        const blockTimeInput = document.getElementById('chain-block-time') as HTMLInputElement;
        if (blockTimeInput) blockTimeInput.value = '';

        const memoRegexInput = document.getElementById('chain-memo-regex') as HTMLTextAreaElement;
        if (memoRegexInput) memoRegexInput.value = '';

        const memoRequiredInput = document.getElementById('chain-memo-required') as HTMLInputElement;
        if (memoRequiredInput) {
            memoRequiredInput.checked = false;
            memoRequiredInput.dispatchEvent(new Event('change'));
        }

        this.toggleSupersededByVisibility();

        // Remove cancel button
        const cancelBtn = document.getElementById('btn-cancel-edit');
        if (cancelBtn) {
            cancelBtn.remove();
        }

        // Clear row selection
        const container = document.getElementById('ext-chain-list-container');
        if (container) {
            Array.from(container.children).forEach(r => (r as HTMLElement).style.backgroundColor = '#fff');
        }
    }

    private renderAnnotations(): void {
        const container = document.getElementById('annotations-list');
        if (!container) return;

        container.innerHTML = '';
        Object.entries(this.annotations).forEach(([key, value]) => {
            const chip = document.createElement('div');
            chip.style.backgroundColor = '#e0f2fe';
            chip.style.color = '#0369a1';
            chip.style.padding = '2px 8px';
            chip.style.borderRadius = '12px';
            chip.style.fontSize = '10px';
            chip.style.display = 'flex';
            chip.style.alignItems = 'center';
            chip.style.gap = '4px';
            chip.style.border = '1px solid #bae6fd';

            chip.innerHTML = `<span><b>${key}:</b> ${value}</span>`;

            const removeBtn = document.createElement('span');
            removeBtn.innerHTML = '&times;';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontWeight = 'bold';
            removeBtn.onclick = () => {
                delete this.annotations[key];
                this.renderAnnotations();
            };

            chip.appendChild(removeBtn);
            container.appendChild(chip);
        });
    }

    private renderRpcs(): void {
        const container = document.getElementById('rpc-list');
        if (!container) return;
        container.innerHTML = '';
        this.rpcs.forEach((url, index) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.fontSize = '10px';
            row.style.backgroundColor = '#f1f5f9';
            row.style.padding = '4px 8px';
            row.style.borderRadius = '4px';

            const span = document.createElement('span');
            span.textContent = url;
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.whiteSpace = 'nowrap';

            const btn = document.createElement('span');
            btn.innerHTML = '&times;';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = 'bold';
            btn.style.color = '#dc2626';
            btn.onclick = () => {
                this.rpcs.splice(index, 1);
                this.renderRpcs();
            };

            row.appendChild(span);
            row.appendChild(btn);
            container.appendChild(row);
        });
    }

    private renderWsRpcs(): void {
        const container = document.getElementById('ws-rpc-list');
        if (!container) return;
        container.innerHTML = '';
        this.wsRpcs.forEach((url, index) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.fontSize = '10px';
            row.style.backgroundColor = '#f1f5f9';
            row.style.padding = '4px 8px';
            row.style.borderRadius = '4px';

            const span = document.createElement('span');
            span.textContent = url;
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.whiteSpace = 'nowrap';

            const btn = document.createElement('span');
            btn.innerHTML = '&times;';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = 'bold';
            btn.style.color = '#dc2626';
            btn.onclick = () => {
                this.wsRpcs.splice(index, 1);
                this.renderWsRpcs();
            };

            row.appendChild(span);
            row.appendChild(btn);
            container.appendChild(row);
        });
    }

    setupFormHandlers(): void {
        const form = document.getElementById('form-add-chains');
        if (!form) return;

        // Color and Gradient Logic
        const startPick = document.getElementById('chain-bgcolor-start') as HTMLInputElement;
        const midPick = document.getElementById('chain-bgcolor-mid') as HTMLInputElement;
        const endPick = document.getElementById('chain-bgcolor-end') as HTMLInputElement;
        const bgTypeRadios = document.getElementsByName('bgType') as NodeListOf<HTMLInputElement>;
        const previewBox = document.getElementById('chain-color-preview');
        const fontSelect = document.getElementById('chain-font-color') as HTMLSelectElement;

        const getBgType = () => {
            for (const radio of Array.from(bgTypeRadios)) {
                if (radio.checked) return radio.value;
            }
            return 'single';
        };

        const updatePreview = () => {
            if (!previewBox) return;
            const type = getBgType();

            let bg = startPick.value;
            if (type === 'gradient2') {
                bg = `linear-gradient(135deg, ${startPick.value}, ${endPick.value})`;
                midPick.parentElement!.style.display = 'none';
                endPick.parentElement!.style.display = 'block';
            } else if (type === 'gradient3') {
                bg = `linear-gradient(135deg, ${startPick.value}, ${midPick.value}, ${endPick.value})`;
                midPick.parentElement!.style.display = 'block';
                endPick.parentElement!.style.display = 'block';
            } else {
                midPick.parentElement!.style.display = 'none';
                endPick.parentElement!.style.display = 'none';
            }

            previewBox.style.background = bg;
            previewBox.style.color = fontSelect.value;
        };

        startPick.addEventListener('input', updatePreview);
        midPick.addEventListener('input', updatePreview);
        endPick.addEventListener('input', updatePreview);
        fontSelect.addEventListener('change', updatePreview);
        bgTypeRadios.forEach(r => r.addEventListener('change', updatePreview));

        const nsSelect = document.getElementById('chain-namespace') as HTMLSelectElement;
        const refHelper = document.getElementById('reference-helper');
        if (nsSelect && refHelper) {
            nsSelect.addEventListener('change', () => {
                refHelper.textContent = NAMESPACE_HELPERS[nsSelect.value] || '';
                this.toggleSupersededByVisibility();
            });
        }

        // Annotations Logic
        const addAnnotationBtn = document.getElementById('btn-add-annotation');
        const keyInput = document.getElementById('annotation-key') as HTMLInputElement;
        const valInput = document.getElementById('annotation-value') as HTMLInputElement;

        if (addAnnotationBtn && keyInput && valInput) {
            addAnnotationBtn.addEventListener('click', () => {
                const key = keyInput.value.trim().toLowerCase();
                const val = valInput.value.trim();
                if (key && val) {
                    this.annotations[key] = val;
                    this.renderAnnotations();
                    keyInput.value = '';
                    valInput.value = '';
                }
            });
        }

        // RPC Logic
        const addRpcBtn = document.getElementById('btn-add-rpc');
        const rpcInput = document.getElementById('rpc-value') as HTMLInputElement;

        if (addRpcBtn && rpcInput) {
            addRpcBtn.addEventListener('click', () => {
                const val = rpcInput.value.trim();
                if (val && !this.rpcs.includes(val)) {
                    this.rpcs.push(val);
                    this.renderRpcs();
                    rpcInput.value = '';
                }
            });
        }

        // WS RPC Logic
        const addWsRpcBtn = document.getElementById('btn-add-ws-rpc');
        const wsRpcInput = document.getElementById('ws-rpc-value') as HTMLInputElement;

        if (addWsRpcBtn && wsRpcInput) {
            addWsRpcBtn.addEventListener('click', () => {
                const val = wsRpcInput.value.trim();
                if (val && !this.wsRpcs.includes(val)) {
                    this.wsRpcs.push(val);
                    this.renderWsRpcs();
                    wsRpcInput.value = '';
                }
            });
        }

        // Memo logic
        const memoRequiredInput = document.getElementById('chain-memo-required') as HTMLInputElement;
        const memoRegexContainer = document.getElementById('chain-memo-regex-container');
        if (memoRequiredInput && memoRegexContainer) {
            memoRequiredInput.addEventListener('change', () => {
                memoRegexContainer.style.display = memoRequiredInput.checked ? 'block' : 'none';
            });
        }

        // Form submit logic
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = (document.getElementById('chain-name') as HTMLInputElement).value.trim();
            const namespace = (document.getElementById('chain-namespace') as HTMLSelectElement).value;
            const reference = (document.getElementById('chain-reference') as HTMLInputElement).value.trim();
            const caip2 = namespace === 'others' ? reference : `${namespace}:${reference}`;
            const symbol = (document.getElementById('chain-symbol') as HTMLInputElement).value.trim().toUpperCase();

            // Advanced settings
            const isTestnet = (document.getElementById('chain-is-testnet') as HTMLInputElement).checked;
            const gasPriceGwei = parseFloat((document.getElementById('chain-gas-price') as HTMLInputElement).value) || null;

            const blockTimeRaw = parseInt((document.getElementById('chain-block-time') as HTMLInputElement).value, 10);
            const block_time = isNaN(blockTimeRaw) ? 30 : blockTimeRaw;

            let chainId;
            if (namespace === 'eip155') {
                chainId = parseInt(reference, 10);
            }

            const explorerPrefix = (document.getElementById('chain-explorer-prefix') as HTMLInputElement).value.trim();

            const statusNode = document.getElementById('chain-status') as HTMLSelectElement;
            const status = statusNode ? statusNode.value : 'active';

            const supersededNode = document.getElementById('chain-superseded-by') as HTMLInputElement;
            const supersededBy = supersededNode ? supersededNode.value.trim() : '';

            // Validate CAIP-2 Reference
            const regex = NAMESPACE_REGEX[namespace];
            if (regex && !regex.test(reference)) {
                alert(`Invalid reference for namespace "${namespace}". ${NAMESPACE_HELPERS[namespace]}`);
                return;
            }

            // Uniqueness Checks (Pre-flight)
            const allChains = (window as any).chainManager?.getAllChains() || [];
            const isEditing = !!form.dataset.editingId;
            const editingId = String(form.dataset.editingId); // Normalize to string

            const duplicateCaip2 = allChains.find((c: any) => c.caip2 === caip2 && (!isEditing || String(c._id) !== editingId));
            if (duplicateCaip2) {
                alert(`A chain with CAIP-2 ID "${caip2}" already exists: ${duplicateCaip2.name}`);
                return;
            }

            const code = this.annotations.code;
            if (!code) {
                alert('Annotation code is required. Please add it in Dynamic Annotations with key "code".');
                return;
            }

            const duplicateCode = allChains.find((c: any) => c.annotation?.code === code && (!isEditing || String(c._id) !== editingId));
            if (duplicateCode) {
                alert(`A chain with annotation code "${code}" already exists: ${duplicateCode.name}`);
                return;
            }

            // Construct payload
            const annotation = { ...this.annotations };

            const type = getBgType();
            let bgColor = startPick.value;
            if (type === 'gradient2') {
                bgColor = `linear-gradient(135deg, ${startPick.value}, ${endPick.value})`;
            } else if (type === 'gradient3') {
                bgColor = `linear-gradient(135deg, ${startPick.value}, ${midPick.value}, ${endPick.value})`;
            }

            const fontColor = fontSelect.value;
            const regexInput = (document.getElementById('chain-regex') as HTMLTextAreaElement).value.trim();
            const patterns = regexInput
                ? regexInput.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
                : [`/(^|\\s|:|-|\\[)((?:0x)[0-9a-fA-F]{40})($|\\s|\\])/gi`];
            const caseSensitive = (document.getElementById('chain-case-sensitive') as HTMLInputElement).checked;

            const memoRequired = (document.getElementById('chain-memo-required') as HTMLInputElement).checked;
            const memoRegexInputText = (document.getElementById('chain-memo-regex') as HTMLTextAreaElement).value.trim();
            let memoPatterns = memoRegexInputText
                ? memoRegexInputText.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
                : [];

            if (memoRequired && memoPatterns.length === 0) {
                memoPatterns = [`/(^|\\s|:|-|\\[)([0-9A-Za-z\\-_]{1,120})($|\\s|\\])/gi`];
            }

            const body: any = {
                name,
                caip2,
                symbol,
                annotation,
                isTestnet,
                gasPriceGwei,
                block_time,
                rpc: this.rpcs.length > 0 ? this.rpcs : ["placeholder"],
                wsRpc: this.wsRpcs.length > 0 ? this.wsRpcs : ["placeholder"],
                blockExplorerPrefix: explorerPrefix,
                bgColor,
                fontColor,
                addrRegexPatterns: patterns,
                addrCaseSensitive: caseSensitive,
                memoRequired,
                memoRegexPatterns: memoPatterns,
                status
            };

            if (chainId !== undefined && !isNaN(chainId)) {
                body.chainId = chainId;
            }

            if (status === 'deprecated' && supersededBy) {
                body.supersededBy = supersededBy;
            } else if (status === 'deprecated' && !supersededBy) {
                alert('A Superseded By CAIP-2 ID is required if the chain is deprecated.');
                return;
            }

            this.updateStatus('Submitting chain...', 'pending');

            let result;
            if (form.dataset.editingId) {
                // Update existing chain
                result = await this.updateDataToServer(body, form.dataset.editingId);
                if (result) {
                    await chrome.storage.local.remove('extensionFormDraft');
                    this.updateStatus('Chain updated', 'success');
                    this.resetForm();
                }
            } else {
                // Create new chain
                result = await this.addDataToServer(body);
                if (result) {
                    await chrome.storage.local.remove('extensionFormDraft');
                    this.resetForm();
                    this.updateStatus('Chain submitted', 'success');
                }
            }
        });


        // Initial call
        updatePreview();

        // Regex conversion logic
        const setupRegexConverter = (btnId: string, inputId: string) => {
            const convertBtn = document.getElementById(btnId);
            if (convertBtn) {
                convertBtn.addEventListener('click', () => {
                    const regexInput = document.getElementById(inputId) as HTMLTextAreaElement;
                    if (!regexInput) return;

                    const lines = regexInput.value.split('\n');
                    const convertedLines = lines.map(line => {
                        const trimmed = line.trim();
                        if (!trimmed) return line;
                        return transformToExtractionPattern(trimmed);
                    });

                    regexInput.value = convertedLines.join('\n');
                    this.updateStatus('Regex updated to extraction mode', 'info');
                });
            }
        };

        setupRegexConverter('btn-convert-regex', 'chain-regex');
        setupRegexConverter('btn-convert-memo-regex', 'chain-memo-regex');
    }
    setupFilterHandler(): void {
        const searchForm = document.getElementById('form-chain-search');
        if (!searchForm) return;

        searchForm.addEventListener('submit', async (event: Event) => {
            event.preventDefault();
        });

        const searchInput = document.getElementById('ext-etheraddresslookup-search-chain') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value || '';
                const chainManager = (window as any).chainManager;
                if (chainManager) {
                    const chains = chainManager.getAllChains();
                    this.renderChainList(chains, query);
                }
            });
        }
    }

    private toggleSupersededByVisibility(): void {
        const nsSelect = document.getElementById('chain-namespace') as HTMLSelectElement;
        const container = document.getElementById('superseded-by-container');
        if (!nsSelect || !container) return;

        if (nsSelect.value === 'cosmos') {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }
}
