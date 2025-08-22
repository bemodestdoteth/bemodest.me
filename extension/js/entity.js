class Entities {
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
     */
    async add (body) {
        let result = await this.get(ENTITY_ADDRESSES_KEY);
        result = {...result[ENTITY_ADDRESSES_KEY], ...body};
        await this.set(result);
    };

    /**
     * @name remove
     * @desc Removes one or more items from local storage.
     * @param {String | Array} key
     * @return {Promise}
     */
    async remove(name) {
        const result = await this.get(ENTITY_ADDRESSES_KEY);
        delete result[ENTITY_ADDRESSES_KEY][name];
        await this.set(result);
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

    // Development purpose
    // async fetchDataFromServer() {
    //     const entityFile = await fetch('../test/entity.json');
    //     const entityFile2 = await entityFile.text()
    //     const entityData = JSON.parse(entityFile2);
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
            const serverResponse = await fetch(`${downloadURL}?key=entity`, serverConfig);

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
            const localData = await this.get(ENTITY_ADDRESSES_KEY);
            console.log(data);
            console.log(localData);

            // No data on local storage
            if (localData[ENTITY_ADDRESSES_KEY] === undefined) {
                await this.set(data);
            } else if (this.compareKeys(data[ENTITY_ADDRESSES_KEY], localData[ENTITY_ADDRESSES_KEY])) {
                console.log("Label Data is up to date.");
            } else {
                console.log("Label Data is not up to date.");
                // Convert chain string to chain class
                await this.set(data);
            }
        }
      catch(err) {
          console.error('Error: ', err);
      }
    }

    compareArrays(arr1, arr2) {
        if (arr1.length !== arr2.length) {
            return false; // They have different number of keys
        }
        
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) {
                return false; // Key in obj1 is not present in obj2
            }
        }
        
        return true;
    }

    /**
     * @name fetchEntityFromServer
     * @desc Send data to my server and fetch entity data from AWS S3 with signed URL
     * @returns {void}
     */
    async fetchEntityFromServer() {
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
            const serverResponse = await fetch(`${downloadURL}?key=entity`, serverConfig);

            if (serverResponse.status !== 200) {
            console.log('Looks like there was a problem when downloading data from the server. Status Code: ' + serverResponse.status);
            return;
            }

            const result = await serverResponse.json();

            // Access the signed URL
            const signedURLresponse = await fetch(result.url);
            if (signedURLresponse.status !== 200) {
                console.log('Looks like there was a problem when accessing signed url. Status Code: ' + response.status);
                return;
            }
            console.log(signedURLresponse);

            // Compare fetched data key with local data key
            const data = await JSON.parse(await signedURLresponse.text());
            const localData = await this.get(ENTITY_ADDRESSES_KEY);
            // No data on local storage
            if (localData[ENTITY_ADDRESSES_KEY] === undefined) {
                await this.set(data);
            } else if (this.compareArrays(data[ENTITY_ADDRESSES_KEY],localData[ENTITY_ADDRESSES_KEY])) {
                console.log("Entity Data is up to date.");
            } else {
                console.log("Entity Data is not up to date.");
                await this.set(data);
            }
            this.setEntityTextArea();
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
    async deleteDataToServer(name) {
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
                body: JSON.stringify({address: address}),
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
     * @name updateChainOption
     * @desc Update the chain option in the form Using custom dropdown
     * @return {void}
     */
    updateOption() {    
        const selectedElement = document.getElementById('select-entities');

        selectedElement.addEventListener('change', async (event) => {
            const entity = await this.get(ENTITY_ADDRESSES_KEY);
            const selectedEntity = entity[ENTITY_ADDRESSES_KEY][selectedElement.value];
            document.getElementById('entity-name').value = selectedElement.value;
            document.getElementById('entity-image').value = selectedEntity.image;
            document.getElementById('entity-comment').value = selectedEntity.comment;
            document.getElementById('entity-track').checked = selectedEntity.tracking;
        });
    }

    /**
     * @name updateLabelsList
     * @desc Update the labels list
     * @return {void}
     */
    async setupEntityDropdownHandler() {
        const entities = await this.get(ENTITY_ADDRESSES_KEY);
        const entityDropdown = document.getElementById('label-entity');
        Object.keys(entities[ENTITY_ADDRESSES_KEY]).forEach((entity) => {
            let option = document.createElement('option');
            option.id = entities[ENTITY_ADDRESSES_KEY]['code'];
            option.textContent = entity;
            option.style.color = '#000000';
            entityDropdown.appendChild(option);
        });
    }

    /**
     * @name setupFormSubmitHandler
     * @desc Setup the form submit button handler
     * @return {void}
     */
    async setupEntityTextArea() {
        const entities = await this.get(ENTITY_ADDRESSES_KEY);
        const entitySelect = document.getElementById('select-entities');
        Object.keys(entities[ENTITY_ADDRESSES_KEY]).forEach((entity) => {
            let option = document.createElement('option');
            option.id = entities[ENTITY_ADDRESSES_KEY]['code'];
            option.textContent = entity;
            option.style.color = '#000000';
            entitySelect.appendChild(option);
        });
    }

    /**
     * @name setupFormSubmitHandler
     * @desc Setup the form submit button handler
     * @return {void}
     */
    setupFormSubmitHandler() {
        document.getElementById('form-add-entities').addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.querySelector(ENTITY_NAME_SELECTOR).value;
            const code = name.toLowerCase().replace(/\./g, '');
            const image = document.querySelector(ENTITY_IMAGE_SELECTOR).value;
            const comment = document.querySelector(ENTITY_COMMENT_SELECTOR).value;
            const tracking = document.querySelector(ENTITY_TRACK_SELECTOR).checked;

            if (!name) {
                alert('PLease make sure that "Name" is filled.');
            }

            const body = {[name]: {
                "code": code,
                "image": image,
                "comment": comment,
                "tracking": tracking,
                "key": "entity"
                }
            };

            const response = await this.addDataToServer(body);
            if (response !== undefined) {
                delete body[name].key;
                await this.add(body);
                alert(response);
            }

        });
    }

    setupDeleteHandler() {
        document.getElementById('form-delete-entities').addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.querySelector("entity-to-delete").value;

            if (!name) {
                alert('Select an entity to delete.');
            }

            const response = await this.deleteDataToServer(name);
            if (response !== undefined) {
                await this.remove(body);
                alert(response);
            }

        });
    }
}