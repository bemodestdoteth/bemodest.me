window.addEventListener('load', () => {
    const labels = new Labels();
    const entities = new Entities();
    labels.fetchDataFromServer();
    labels.setupFormSubmitHandler();
    labels.setupDownloadHandler();
    labels.setupFilterHandler();
    labels.setupResetHandler();
    labels.updateChainOption();
    entities.fetchDataFromServer();
    entities.setupEntityDropdownHandler();
    entities.updateOption();
    entities.setupEntityTextArea()
    entities.setupFormSubmitHandler();
});