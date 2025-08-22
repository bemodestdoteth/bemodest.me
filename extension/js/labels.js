class Labels {
    constructor(scope = chrome.storage.local) {
        this.scope = scope;
    }

    /**
     * @name get
     * @desc Gets one or more items from storage.
     * @param {String | Array} key
     * @return {Promise}
     */
    get(key) {
        return new Promise((resolve, reject) => {
            this.scope.get(key, (items) => {
                if (chrome.runtime.lastError){
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
    async set(dataObject) {
        return new Promise((resolve, reject) => {
            this.scope.set(dataObject, () => {
                if (chrome.runtime.lastError){
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
     * @param {string} address - Address to label
     * @param {string} name - Label name
     * @param {string} chain - Chain name
     * @param {string} comment - Comment
     * @param {*boolean} tracking - Tracking
     */
    async add (body) {
        const localData = await this.get(LABELLED_ADDRESSES_KEY);
        Object.values(body).forEach((value) => {
            value['chain'] = window.createInstance(value['chain']);
        });
        localData[LABELLED_ADDRESSES_KEY] = {...localData[LABELLED_ADDRESSES_KEY], ...body};
        await this.set(localData);
    };

    /**
     * @name remove
     * @desc Removes one or more items from local storage.
     * @param {String | Array} key
     * @return {Promise}
     */
    async remove(address) {
        const localData = await this.get(LABELLED_ADDRESSES_KEY);
        delete localData[LABELLED_ADDRESSES_KEY][address];
        await this.set(localData);
    }

    /**
     * @name clear
     * @desc Clears local storage.
     * @returns {Promise}
     */
    clear() {
        return new Promise((resolve) => {
            this.scope.clear(() => {
                if (chrome.runtime.lastError){
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
     * @returns {string} Hashed string
     */
    async hashString(input) {
        // Generate a signature using the secret key and the current Unix timestamp
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
    compareKeys(obj1, obj2) {
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

    // Test code
    // async fetchDataFromServer() {
    //     const entityFile = await fetch('../test/data.json');
    //     const entityFile2 = await entityFile.text()
    //     const entityData = JSON.parse(entityFile2);
    //     console.log(entityData);
    //     await this.set(entityData);
    // }

    /**
     * @name fetchLabelFromServer
     * @desc Send data to my server and fetch label data from AWS S3 with signed URL
     * @returns {void}
     */
    async fetchDataFromServer() {
        try {
            // Read the secret key from "hash.txt"
            const timeStamp = Math.floor(Date.now() / 1000).toString();
            const response = await fetch('./hash.txt');
            const text = await response.text();
            const lines = text.split('\n');
            const secretKey = lines[0].trim();
            const downloadURL = lines[1].trim();

            // Send the request to the server along with the signature and timestamp
            const serverConfig = {method: 'GET', headers: {
                    'accept': 'application/json',
                    'X-Signature': await this.hashString(secretKey+timeStamp),
                    'X-Timestamp': timeStamp
                }
            };
            const serverResponse = await fetch(`${downloadURL}?key=label`, serverConfig);

            if (serverResponse.status !== 200) {
            console.log('Looks like there was a problem when downloading data from the server. Status Code: ' + serverResponse.status);
            return;
            }

            const result = await serverResponse.json();
            const signedURLresponse = await fetch(result.url);
            if (signedURLresponse.status !== 200) {
                console.log('Looks like there was a problem when accessing signed url. Status Code: ' + response.status);
                return;
            }

            // Compare fetched data key with local data key
            const data = await JSON.parse(await signedURLresponse.text());
            const localData = await this.get(LABELLED_ADDRESSES_KEY);

            // No data on local storage
            if (localData[LABELLED_ADDRESSES_KEY] === undefined) {
                Object.keys(data[LABELLED_ADDRESSES_KEY]).map((address) => {
                    data[LABELLED_ADDRESSES_KEY][address]['chain'] = window.createInstance(data[LABELLED_ADDRESSES_KEY][address]['chain'])
                });
                await this.set(data);
            } else if (this.compareKeys(data[LABELLED_ADDRESSES_KEY], localData[LABELLED_ADDRESSES_KEY])) {
                console.log("Label Data is up to date.");
            } else {
                console.log("Label Data is not up to date.");
                // Convert chain string to chain class
                Object.keys(data[LABELLED_ADDRESSES_KEY]).map((address) => {
                    data[LABELLED_ADDRESSES_KEY][address]['chain'] = window.createInstance(data[LABELLED_ADDRESSES_KEY][address]['chain'])
                });
                await this.set(data);
            }
        }
      catch(err) {
          console.error('Error: ', err);
      }
    }

    /**
     * @name addDataToServer
     * @desc Send data to my server and save label data to AWS S3 with signed URL
     * @returns {void}
     */
    async addDataToServer(body) {
        try {
            // Only if the data exists in local storage
            const localData = await this.get(LABELLED_ADDRESSES_KEY);
            if (localData[LABELLED_ADDRESSES_KEY] === undefined) {
                alert("Data does not exist in local storage.");
                return;
            }

            // Read the secret key from "hash.txt"
            const timeStamp = Math.floor(Date.now() / 1000).toString();
            const response = await fetch('./hash.txt');
            const text = await response.text();
            const lines = text.split('\n');
            const secretKey = lines[0].trim();
            const uploadURL = lines[2].trim();
           
            // Send the request to the server along with the signature and timestamp
            body[Object.keys(body)[0]]['key'] = "label";
            const serverConfig = {
                method: 'POST', 
                headers: {
                    'Content-Type': 'application/json',
                    'X-Signature': await this.hashString(secretKey+timeStamp),
                    'X-Timestamp': timeStamp
                },
                body: JSON.stringify(body),
            };
            const serverResponse = await fetch(uploadURL, serverConfig);

            if (serverResponse.status !== 200) {
                alert(`${serverResponse.status}: ${serverResponse.statusText}`);
                return;
            }

            const result = await serverResponse.json();
            return result.message;
        } catch(err) {
            console.error('Error: ', err);
        }
    }

    /**
     * @name deleteDataToServer
     * @desc Send delete data to my server and save label data to AWS S3 with signed URL
     * @returns {void}
     */
    async deleteDataToServer(address) {
        try {
            // Only if the data exists in local storage
            const localData = await this.get(LABELLED_ADDRESSES_KEY);
            if (localData[LABELLED_ADDRESSES_KEY] === undefined) {
                alert("Data does not exist in local storage.");
                return;
            }

            // Read the secret key from "hash.txt"
            const timeStamp = Math.floor(Date.now() / 1000).toString();
            const response = await fetch('./hash.txt');
            const text = await response.text();
            const lines = text.split('\n');
            const secretKey = lines[0].trim();
            const deleteURL = lines[3].trim();

            // Send the request to the server along with the signature and timestamp
            const serverConfig = {
                method: 'POST', 
                headers: {
                    'Content-Type': 'application/json',
                    'X-Signature': await this.hashString(secretKey+timeStamp),
                    'X-Timestamp': timeStamp
                },
                body: JSON.stringify({address: address, "key": "label"}),
            };
            const serverResponse = await fetch(deleteURL, serverConfig);

            if (serverResponse.status !== 200) {
                alert(`${serverResponse.status}: ${serverResponse.statusText}`);
                return;
            }

            const result = await serverResponse.json();
            return result.message;
        } catch(err) {
            console.error('Error: ', err);
        }
    }

    /**
     * @name addLabelsListEvents
     * @desc Add HTML elements and events to the labels list
     * @return {void}
     */
    addLabelsListEvents() {
        const labelsDeleteElements = document.getElementsByClassName("ext-etheraddresslookup-label-delete");

        Array.from(labelsDeleteElements).forEach((element) => {
            element.addEventListener('click', async (event) => {
                const address = event.target.getAttribute('data-ext-etheraddresslookup-label-id');
                const response = await this.deleteDataToServer(address);
                if (response !== undefined) {
                    await this.remove(address);
                    alert(`Address ${address} successfully deleted.`);
                }
            });
        });

        const FILL_LABEL_INPUT_ATTRIBUTE = 'data-fill-label-input';
        document.querySelectorAll(`[${FILL_LABEL_INPUT_ATTRIBUTE}]`).forEach(element => {
            element.addEventListener('click', async (event) => {
                const address = event.target.getAttribute(FILL_LABEL_INPUT_ATTRIBUTE);
                const localData = await this.get(LABELLED_ADDRESSES_KEY);

                const addrVals = localData[LABELLED_ADDRESSES_KEY][address];
                document.querySelector(FORM_NAME_SELECTOR).value = addrVals.label;
                document.querySelector(FORM_ADDRESS_SELECTOR).value = address;
                document.querySelector(FORM_COMMENT_SELECTOR).value = addrVals.comment;
                document.querySelector(FORM_TRACK_SELECTOR).checked = addrVals.tracking;

                let chainElement = document.querySelector("#label-dropdown-value");
                chainElement.textContent = addrVals.chain.name;
                chainElement.style.background = addrVals.chain.bgColor;
                chainElement.style.color = addrVals.chain.fontColor;

                let entityElement = document.querySelector(FORM_ENTITY_SELECTOR);
                entityElement.options[entityElement.selectedIndex].textContent = addrVals.entity;
            });
        });
    }

    /**
     * @name setupFilterHandler
     * @desc Setup the filter handler
     * @return {void}
     */
    setupFilterHandler() {
        // Set up the search bar event handler
        document.getElementById('form-label-search').addEventListener('submit', async (event) => {
            event.preventDefault();
            const query = document.getElementById('ext-etheraddresslookup-search-label').value;
            query === "" ? alert("Please enter a search query.") : await this.updateLabelsList(query);
        });
    }

    /**
     * @name updateLabelsList
     * @desc Update the labels list
     * @param {string} query - Search query in case of filter
     * @return {void}
     */
    async updateLabelsList(query="") {
        const localData = await this.get(LABELLED_ADDRESSES_KEY);
        if (localData[LABELLED_ADDRESSES_KEY] === undefined) {
            console.log("No data in local storage.");
            return;
        }

        let retrievedLabels =  Object.entries(localData[LABELLED_ADDRESSES_KEY]).map(([address, values]) => {
            return [address, ...Object.values(values)];
        });

        const filterLabels = (labels, query, index) => {
            return labels.filter((label) => label[index] && label[index].includes(query));
        }

        if(query !== "") { retrievedLabels = filterLabels(retrievedLabels, query, 6);}

        // Sort labels in ascending order
        retrievedLabels.sort((a, b) => {
            if (a[6] < b[6]) return -1;
            if (a[6] > b[6]) return 1;
            return 0;
        });
        
        let HTMLLabels = '';
        for (const retrievedLabel of retrievedLabels){
            const body = {
                "address": retrievedLabel[0],
                "chain": retrievedLabel[1],
                "code": retrievedLabel[2],
                "comment": retrievedLabel[3],
                "entity": retrievedLabel[4],
                "entityImage": retrievedLabel[5],
                "label": retrievedLabel[6],
                "tracking": retrievedLabel[7]
            }
            HTMLLabels += this.getExtendedTemplate(body);
        }

        document.getElementById('ext-etheraddresslookup-current-labels').innerHTML = HTMLLabels;
        this.addLabelsListEvents();
    }

    /**
     * @name setupDownloadHandler
     * @desc Setup the download button handler
     * @return {void}
     */
    setupDownloadHandler() {
        // To download chrome storage data
        document.getElementById('download-csv').addEventListener('click', async (event) => {
            chrome.storage.local.get(null, (data) => {
                // Convert data to CSV
                const csvHeader = '\uFEFF' + "Address,Label,Code,Comment,Entity\n"; // UTF-8 BOM + header
                const csvContent = Object.keys(data['labelledAddresses']).map(key => {
                    return [
                        key.trim(),
                        data['labelledAddresses'][key].label.trim(),
                        data['labelledAddresses'][key].code.trim(),
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
     * @name getTemplate
     * @desc Get the HTML template for a label
     * @param {object} body - Label data
     * @returns 
     */
    getExtendedTemplate(body) {
        // Tracking Checkbox
        const trackingChecked = body.tracking ? "checked" : "";
        const shortenText = (text, maxLength) => {
            return text ? text.length > maxLength ? text.substring(0, maxLength - 3) + "..." : text : ''
        }
        return `<image class="ext-etheraddresslookup-label-img" src="${body.entityImage}"/>
        <span class='ext-etheraddresslookup-label' data-fill-label-input="${body.address}"
        title="${body.label}&#013;${body.address}&#013;${body.entity}&#013;${body.comment}"
        style="color:${body.chain.fontColor};background:${body.chain.bgColor};font-size:11px">
        ${shortenText(body.label, 18)} ${body.chain.name}
        </span>
        &nbsp;
        <div style="float:right;">
            <input type="checkbox" class="track-this-wallet" value="${body.address}" style="line-height:1.1" ${trackingChecked} disabled>
            <span style="cursor:pointer;" class="ext-etheraddresslookup-label-delete" data-ext-etheraddresslookup-label-id="${body.address}">x</span>
        </div>
        <br/>`;
    }

    /**
     * @name setupFormSubmitHandler
     * @desc Setup the form submit button handler
     * @return {void}
     */
    setupFormSubmitHandler() {
        document.getElementById('ext-etheraddresslookup-new-label-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const localEntity = await this.get(ENTITY_ADDRESSES_KEY);

            const label = document.querySelector(FORM_NAME_SELECTOR).value;
            const chain = window.createInstance(document.querySelector("#label-dropdown-value").textContent);
            const address = chain.addrCaseSensitive ? document.querySelector(FORM_ADDRESS_SELECTOR).value : document.querySelector(FORM_ADDRESS_SELECTOR).value.toLowerCase();

            let entity = document.querySelector(FORM_ENTITY_SELECTOR).options[document.querySelector(FORM_ENTITY_SELECTOR).selectedIndex].textContent;
            let entityImage;
            if (entity === "Entity (Optional)" || entity === "") {
                entity = "";
                entityImage = "";
            } else {
                entityImage = localEntity[ENTITY_ADDRESSES_KEY][entity].image;
            }
            const comment = document.querySelector(FORM_COMMENT_SELECTOR).value;
            const tracking = document.querySelector(FORM_TRACK_SELECTOR).checked;

            // Check if the address is in the correct format
            const matchAnyRegex = (string, patterns) => {
                return patterns.some(pattern => pattern.test(string));
            }
            const isValidAddress = matchAnyRegex(address, chain.addrRegexPatterns);

            if (!isValidAddress) {
                alert('Please make sure that "Address" is in the correct format.');
            } else if (!label || !address || !chain) {
                alert('Please make sure that "Name", "Address", and "Chain" is filled.');
            } else {
                const body = {[address]: {
                    "chain": chain.name,
                    "code": chain.code,
                    "comment": comment,
                    "entity": entity,
                    "entityImage": entityImage,
                    "label": label,
                    "tracking": tracking
                    }
                };
                const response = await this.addDataToServer(body);
                if (response !== undefined) {
                    delete body[address]['key'];
                    await this.add(body);
                    alert(response);
                }
            }
        });
    }

    /**
     * @name setupResetHandler
     * @desc Setup the reset button handler
     * @return {void}
     */
    setupResetHandler() {
        // To download chrome storage data
        document.getElementById('ext-etheraddresslookup-reset').addEventListener('click', async (event) => {
            event.preventDefault();
            if (confirm("Are you sure you want to reset? This will clear all saved data.")) {
                await this.clear();
                await this.updateLabelsList();
                alert("Data has been successfully reset.");
            } else { return;}
        });
    }

    /**
     * @name updateChainOption
     * @desc Update the chain option in the form Using custom dropdown
     * @return {void}
     */
    updateChainOption() {
        const generateChainOption = (chain) => {
            let option = document.createElement('div');
            option.className = 'custom-option';
            option.style.background = chain.bgColor;
            option.style.color = chain.fontColor;
            option.setAttribute('data-value', chain.bgColor);
            option.textContent = chain.name;
            option.onclick = function() {
                const dropdownValue = document.getElementById('label-dropdown-value');
                dropdownValue.textContent = chain.name;
                dropdownValue.setAttribute('data-selected-value', chain.bgColor);
                dropdownValue.style.background = chain.bgColor;
                dropdownValue.style.color = chain.fontColor;
                dropdown.classList.remove('open');
            };
            return option;
        }
    
        const dropdown = document.querySelector(FORM_CHAIN_SELECTOR);
        const chains = window.getValueForEachChains("name");
        
        // Placeholder for selected value
        let dropdownValue = document.createElement('div');
        dropdownValue.id = 'label-dropdown-value';
        dropdownValue.onclick = function() {
            dropdown.classList.toggle('open');
        };
        dropdown.appendChild(dropdownValue);
    
        let isFirst = true;
        chains.forEach(chain => {
            const chainClass = window.createInstance(chain);
            const option = generateChainOption(chainClass);
            dropdown.appendChild(option);
            if (isFirst) {
                dropdownValue.textContent = chainClass.name;
                dropdownValue.setAttribute('data-selected-value', chainClass.bgColor);
                dropdownValue.style.background = chainClass.bgColor;
                dropdownValue.style.color = chainClass.fontColor;
                isFirst = false;
            }
        });
    }
}