const { streamDeckClient } = SDPIComponents

var globalSettings = {}

// Monitor global settings changing.
SDPIComponents.streamDeckClient.didReceiveGlobalSettings.subscribe((settings) => {
	globalSettings = settings.payload.settings
	evaluateConnectionStatus()
})

// Invoke a request for the global settings.
SDPIComponents.streamDeckClient.getGlobalSettings()

// Window level functions to use in the external configuration window
window.getGlobalSettings = () => {
	return globalSettings
}

window.sendGlobalSettingsToInspector = (settings) => {
	globalSettings = settings
	saveGlobalSettings()
}

//show/hide the Page textfield based on the value of the Dynamic Page checkbox
const dynamicPageCheckbox = document.querySelector("sdpi-checkbox[setting='dynamicPage']")

const pageLabel = document.querySelector("sdpi-item[label='Page']")
const pageField = document.querySelector("sdpi-textfield[setting='page']")

const rowField = document.querySelector("sdpi-textfield[setting='row']")
const columnField = document.querySelector("sdpi-textfield[setting='column']")

dynamicPageCheckbox.addEventListener('valuechange', function (ev) {
	let value = ev.target.value

	if (value == 1) {
		pageLabel.style.display = 'none'
		pageField.style.display = 'none'
	} else {
		pageLabel.style.display = 'block'
		pageField.style.display = 'block'
	}
})

// Open the configuration window when the button/text is clicked.
const openConfigButton = document.querySelector('#open-config')
openConfigButton.addEventListener('click', () => {
	window.open('./configuration.html')
})

// Evaluate the connection status and display a message if necessary.
function evaluateConnectionStatus() {
	const companionConnect = document.querySelector('#companion_connect')
	companionConnect.style.display = 'block'

	//remove all classes
	companionConnect.classList.remove('caution')
	companionConnect.classList.remove('info')

	const mode = globalSettings.connectionMode || 'legacy'
	let addressDisplay = ''
	if (mode === 'satellite-tcp') {
		addressDisplay = (globalSettings.satelliteTcpHost || '127.0.0.1') + ':' + (globalSettings.satelliteTcpPort || '16622')
	} else if (mode === 'satellite-ws') {
		addressDisplay = globalSettings.satelliteWsUrl || 'ws://127.0.0.1:16623'
	} else {
		addressDisplay = (globalSettings.ip || '127.0.0.1') + ':' + (globalSettings.port || '28492')
	}

	const isSatellite = mode === 'satellite-tcp' || mode === 'satellite-ws'

	switch (globalSettings.connectionStatus) {
		case 'wrongversion':
			if (isSatellite) {
				companionConnect.innerHTML =
					'<summary style="color:#a20110;">Incompatible Companion version!</summary>' +
					'<p>The Satellite protocol requires Companion 4.3 or later.</p>'
			} else {
				companionConnect.innerHTML =
					'<summary style="color:#a20110;">Incompatible Companion version!</summary>' +
					'<p>You need to install Companion 2.4 or newer.</p>'
			}
			companionConnect.classList.add('caution')
			break
		case 'disconnected':
			if (isSatellite) {
				companionConnect.innerHTML =
					'<summary style="color:#a20110;">Disconnected from Companion!</summary>' +
					'<p>Make sure Companion 4.3 or later is running and the Satellite API is enabled in Companion\'s Settings.</p>'
			} else {
				companionConnect.innerHTML =
					'<summary style="color:#a20110;">Disconnected from Companion!</summary>' +
					"<p>Make sure you have at least Companion version 2.4.0 or newer running on the same machine and that you have enabled support for the Elgato Plugin in Companion's Settings.</p>"
			}
			companionConnect.classList.add('caution')
			break
		case 'connecting':
			companionConnect.innerHTML =
				'<summary style="color:#ffcc00;">Connecting to Companion...</summary>' +
				'<p>Attempting to connect to Companion at ' + addressDisplay + '</p>'
			break
		case 'connected':
			companionConnect.innerHTML =
				'<summary style="color:#009900;">Connected to Companion.</summary>' +
				'<p>Connected to Companion at ' + addressDisplay + '</p>'
			companionConnect.classList.add('info')
			break
		default:
			companionConnect.innerHTML = '<summary>Unknown error: ' + globalSettings.connectionStatus + '</summary>'
			break
	}
}

// Save the global settings to the plugin.
function saveGlobalSettings() {
	streamDeckClient.setGlobalSettings(globalSettings)
}
