// Invoke a request for the global settings.
const globalSettings = window.opener.getGlobalSettings()

// Set the values of the inputs to the current global settings
const inputIP = document.querySelector('#ip')
if (globalSettings.ip) {
	//alert(globalSettings.ip)
	inputIP.value = globalSettings.ip
} else {
	globalSettings.ip = '127.0.0.1'
}
const inputPort = document.querySelector('#port')
if (globalSettings.port) {
	inputPort.value = globalSettings.port
} else {
	globalSettings.port = '28492'
}

// Send settings to property inspect on form edit
inputIP.addEventListener('input', () => {
	const newIP = inputIP.value
	globalSettings.ip = newIP
	//saveSettings()
})
inputPort.addEventListener('input', () => {
	const newPort = inputPort.value
	globalSettings.port = newPort
	//saveSettings()
})

const btnSave = document.querySelector('#save')
btnSave.onclick = () => {
	let ip = inputIP.value
	let port = inputPort.value
	globalSettings.ip = ip
	globalSettings.port = port
	globalSettings.connectionStatus = 'connecting'
	saveSettings()
	window.close()
}

function saveSettings() {
	window.opener.sendGlobalSettingsToInspector(globalSettings)
}
