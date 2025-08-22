const COMPATIBILITY_CHECKBOX_SELECTOR = '[name="ext-etheraddresslookup-compatibility_mode"]';
window.addEventListener('load', function() {
    document.querySelector(COMPATIBILITY_CHECKBOX_SELECTOR).addEventListener('click', toggleCompatibilityMode);
    refresCompatibilityMode();
});

//Sets the local storage to remember their match highlight settings
function toggleCompatibilityMode()
{
    var objCompatibilityMode = document.querySelector(COMPATIBILITY_CHECKBOX_SELECTOR);
    var intCompatibilityMode = objCompatibilityMode.checked ? 1 : 0;
    localStorage.setItem("ext-etheraddresslookup-compatibility_mode", intCompatibilityMode);
    refresCompatibilityMode();
}

function refresCompatibilityMode()
{
    let intCompatibilityMode = localStorage.getItem("ext-etheraddresslookup-compatibility_mode");
    if(intCompatibilityMode === null) {
        intCompatibilityMode = 1;
    }
    console.log(document.getElementById("ext-etheraddresslookup-compatibility_mode").checked)
    document.getElementById("ext-etheraddresslookup-compatibility_mode").checked = (intCompatibilityMode == 1 ? true : false);
}