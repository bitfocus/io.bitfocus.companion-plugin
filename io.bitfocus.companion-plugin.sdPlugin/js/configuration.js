// Invoke a request for the global settings.
const globalSettings = window.opener.getGlobalSettings()

// Hack in titles for the items
const items = document.querySelectorAll("sdpi-item")
for (const item of items) {
	if (item.hasAttribute('title')) {
		const labelElm = item.querySelector('label')
		if (labelElm) {
			labelElm.title = item.getAttribute('title')
		}
	}
}

// Element references
const modeSelect = document.querySelector('#connectionMode')
const warningDiv = document.querySelector('#protocol-warning')
const sectionSatTcp = document.querySelector('#section-satellite-tcp')
const sectionSatWs = document.querySelector('#section-satellite-ws')
const sectionDeviceId = document.querySelector('#section-device-id')
const sectionLegacy = document.querySelector('#section-legacy')

const inputSatTcpHost = document.querySelector('#satelliteTcpHost')
const inputSatTcpPort = document.querySelector('#satelliteTcpPort')
const inputSatWsUrl = document.querySelector('#satelliteWsUrl')
const inputDeviceIdSuffix = document.querySelector('#satelliteDeviceIdSuffix')
const inputIP = document.querySelector('#ip')
const inputPort = document.querySelector('#port')

// Populate fields from global settings
modeSelect.value = globalSettings.connectionMode || 'satellite-tcp'
if (globalSettings.satelliteTcpHost) inputSatTcpHost.value = globalSettings.satelliteTcpHost
if (globalSettings.satelliteTcpPort) inputSatTcpPort.value = globalSettings.satelliteTcpPort
if (globalSettings.satelliteWsUrl) inputSatWsUrl.value = globalSettings.satelliteWsUrl
if (globalSettings.satelliteDeviceIdSuffix) inputDeviceIdSuffix.value = globalSettings.satelliteDeviceIdSuffix
if (globalSettings.ip) inputIP.value = globalSettings.ip
if (globalSettings.port) inputPort.value = globalSettings.port

// Mode section visibility
function updateModeSections() {
	const mode = modeSelect.value
	const isSatellite = mode === 'satellite-tcp' || mode === 'satellite-ws'

	sectionSatTcp.classList.toggle('active', mode === 'satellite-tcp')
	sectionSatWs.classList.toggle('active', mode === 'satellite-ws')
	sectionDeviceId.classList.toggle('active', isSatellite)
	sectionLegacy.classList.toggle('active', mode === 'legacy')

	warningDiv.className = ''
	if (isSatellite) {
		warningDiv.className = 'warn-satellite'
		warningDiv.textContent = 'Requires Companion 4.3 or later with Satellite API enabled.'
	} else {
		warningDiv.className = 'warn-legacy'
		warningDiv.textContent = 'This protocol is deprecated and will be removed in a future Companion release.'
	}
}

// sdpi-select fires 'valuechange'
modeSelect.addEventListener('valuechange', updateModeSections)
updateModeSections()

// Save
document.querySelector('#save').onclick = () => {
	globalSettings.connectionMode = modeSelect.value
	globalSettings.satelliteTcpHost = inputSatTcpHost.value || '127.0.0.1'
	globalSettings.satelliteTcpPort = inputSatTcpPort.value || '16622'
	globalSettings.satelliteWsUrl = inputSatWsUrl.value || 'ws://127.0.0.1:16623'
	globalSettings.satelliteDeviceIdSuffix = inputDeviceIdSuffix.value
	globalSettings.ip = inputIP.value || '127.0.0.1'
	globalSettings.port = inputPort.value || '28492'
	globalSettings.connectionStatus = 'connecting'
	window.opener.sendGlobalSettingsToInspector(globalSettings)
	window.close()
}
