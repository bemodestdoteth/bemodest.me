import { transformToExtractionPattern } from '@bemodest/utils/regex';
export class Chains {
    private statusDiv: HTMLElement | null;

    constructor() {
        this.statusDiv = document.getElementById('status');
        this.setupMessageListener();
        this.fetchDataFromServer();
        this.setupFilterHandler();
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
            const displayCode = chain.code || chain.chain || '?';
            preview.textContent = displayCode.substring(0, 1);

            const infoDiv = document.createElement('div');
            infoDiv.style.flex = '1';

            const nameEl = document.createElement('div');
            nameEl.style.fontWeight = '500';
            nameEl.style.fontSize = '13px';
            nameEl.textContent = `${chain.name} (${displayCode})`;

            const detailsEl = document.createElement('div');
            detailsEl.style.fontSize = '11px';
            detailsEl.style.color = '#666';

            // Show label usage count
            const usageText = chain.labelCount !== undefined ? `Labels: ${chain.labelCount}` : '';
            const regexText = `Regex: ${chain.addrRegexPatterns?.length || 0}`;
            detailsEl.textContent = `${regexText} | ${usageText}`;

            infoDiv.appendChild(nameEl);
            infoDiv.appendChild(detailsEl);

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.className = 'btn btn-sm btn-error';
            delBtn.style.padding = '0 6px';
            delBtn.style.height = '24px';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
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
        form.dataset.editingId = chain._id;

        // Populate fields
        (document.getElementById('chain-name') as HTMLInputElement).value = chain.name;
        // Code is no longer used/required
        const codeInput = document.getElementById('chain-code') as HTMLInputElement;
        if (codeInput) codeInput.value = chain.code || chain.chain || '';
        (document.getElementById('chain-explorer-prefix') as HTMLInputElement).value = chain.blockExplorerPrefix || '';
        (document.getElementById('chain-explorer-postfix') as HTMLInputElement).value = chain.blockExplorerPostfix || '';

        // Populate regex (join array with newlines for textarea)
        const regexInput = document.getElementById('chain-regex') as HTMLTextAreaElement;
        if (chain.addrRegexPatterns && chain.addrRegexPatterns.length > 0) {
            regexInput.value = chain.addrRegexPatterns.join('\n');
        } else {
            regexInput.value = '';
        }

        // Set case sensitive
        (document.getElementById('chain-case-sensitive') as HTMLInputElement).checked = chain.addrCaseSensitive || false;

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

        // Form submit logic
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = (document.getElementById('chain-name') as HTMLInputElement).value.trim();
            // Code field value is ignored/removed from payload
            const explorerPrefix = (document.getElementById('chain-explorer-prefix') as HTMLInputElement).value.trim();
            const explorerPostfix = (document.getElementById('chain-explorer-postfix') as HTMLInputElement).value.trim();

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

            if (!name || !explorerPrefix) {
                alert('Please fill in all required fields');
                return;
            }

            const body = {
                name,
                // code: REMOVED per user request
                blockExplorerPrefix: explorerPrefix,
                blockExplorerPostfix: explorerPostfix,
                bgColor,
                fontColor,
                addrRegexPatterns: patterns,
                addrCaseSensitive: caseSensitive
            };

            this.updateStatus('Submitting chain...', 'pending');

            let result;
            if (form.dataset.editingId) {
                // Update existing chain
                result = await this.updateDataToServer(body, form.dataset.editingId);
                if (result) {
                    this.updateStatus('Chain updated', 'success');
                    this.resetForm();
                }
            } else {
                // Create new chain
                result = await this.addDataToServer(body);
                if (result) {
                    this.resetForm();
                    this.updateStatus('Chain submitted', 'success');
                }
            }
        });


        // Initial call
        updatePreview();

        // Regex conversion logic
        const convertBtn = document.getElementById('btn-convert-regex');
        if (convertBtn) {
            convertBtn.addEventListener('click', () => {
                const regexInput = document.getElementById('chain-regex') as HTMLTextAreaElement;
                if (!regexInput) return;

                const lines = regexInput.value.split('\n');
                const convertedLines = lines.map(line => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;

                    // Dynamically import utility to avoid global scope issues in constructor if needed
                    // But here we can just import at top if it was a module
                    // Since this is extension code, we'll use the imported utility
                    return transformToExtractionPattern(trimmed);
                });

                regexInput.value = convertedLines.join('\n');
                this.updateStatus('Regex updated to extraction mode', 'info');
            });
        }
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
}
