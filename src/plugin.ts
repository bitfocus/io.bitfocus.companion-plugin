import { GlobalSettings } from './types/types'

import streamDeck, { DidReceiveGlobalSettingsEvent } from '@elgato/streamdeck'
import { randomBytes } from 'node:crypto'

import { connection } from './companion-connection'

import { CompanionButtonAction } from './actions/action'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel('debug')

// Register the actions.
const mainAction = new CompanionButtonAction()
streamDeck.actions.registerAction(mainAction)

// Finally, connect to the Stream Deck.
streamDeck.connect()

// Get the global settings
streamDeck.settings.getGlobalSettings()

// Track last connection key to avoid re-connecting when only connectionStatus changed
let lastConnectionKey = ''

// Global settings received
streamDeck.settings.onDidReceiveGlobalSettings((settings: DidReceiveGlobalSettingsEvent<GlobalSettings>) => {
	console.log('Got global settings:', settings)
	streamDeck.logger.info('Got global settings')
	streamDeck.logger.info(settings)

	const s = settings.settings
	let needsSave = false

	// Migration: determine connectionMode for existing users
	if (!s.connectionMode) {
		if (s.ip) {
			s.connectionMode = 'legacy'
		} else {
			s.connectionMode = 'satellite-tcp'
		}
		needsSave = true
	}

	// Ensure defaults
	if (!s.ip) { s.ip = '127.0.0.1'; needsSave = true }
	if (!s.port) { s.port = 28492; needsSave = true }
	if (!s.satelliteTcpHost) { s.satelliteTcpHost = '127.0.0.1'; needsSave = true }
	if (!s.satelliteTcpPort) { s.satelliteTcpPort = 16622; needsSave = true }
	if (!s.satelliteWsUrl) { s.satelliteWsUrl = 'ws://127.0.0.1:16623'; needsSave = true }
	if (!s.satelliteDeviceIdSuffix) {
		s.satelliteDeviceIdSuffix = randomBytes(6).toString('hex')
		needsSave = true
	}
	if (!s.connectionStatus) { s.connectionStatus = ''; needsSave = true }

	if (needsSave) {
		streamDeck.settings.setGlobalSettings(s).catch((e) => {
			streamDeck.logger.warn(`Failed to save global settings: ${e}`)
		})
	}

	// Build a key from connection-relevant settings only (not connectionStatus)
	const connectionKey = JSON.stringify({
		mode: s.connectionMode,
		ip: s.ip,
		port: s.port,
		satelliteTcpHost: s.satelliteTcpHost,
		satelliteTcpPort: s.satelliteTcpPort,
		satelliteWsUrl: s.satelliteWsUrl,
		satelliteDeviceIdSuffix: s.satelliteDeviceIdSuffix,
	})

	if (connectionKey === lastConnectionKey) {
		streamDeck.logger.debug('Connection settings unchanged (only connectionStatus changed), skipping reconnect')
		return
	}

	const prevMode = lastConnectionKey ? JSON.parse(lastConnectionKey).mode : 'none'
	lastConnectionKey = connectionKey

	const deviceId = `elgato-plugin:${s.satelliteDeviceIdSuffix}`

	if (s.connectionMode === 'satellite-tcp') {
		streamDeck.logger.info(`Connection mode: ${prevMode} → satellite-tcp (${s.satelliteTcpHost}:${s.satelliteTcpPort}, device=${deviceId})`)
		connection.setConnectionMode({
			mode: 'satellite-tcp',
			host: s.satelliteTcpHost,
			port: s.satelliteTcpPort,
			deviceId,
		})
	} else if (s.connectionMode === 'satellite-ws') {
		streamDeck.logger.info(`Connection mode: ${prevMode} → satellite-ws (${s.satelliteWsUrl}, device=${deviceId})`)
		connection.setConnectionMode({
			mode: 'satellite-ws',
			url: s.satelliteWsUrl,
			deviceId,
		})
	} else {
		streamDeck.logger.info(`Connection mode: ${prevMode} → legacy (${s.ip}:${s.port})`)
		connection.setConnectionMode({
			mode: 'legacy',
			ip: s.ip,
			port: s.port,
		})
	}
})

connection.on('wrongversion', () => {
	streamDeck.logger.info('wrong version')
	mainAction.connectionStateChange()
})

connection.on('connected', () => {
	streamDeck.logger.info('Connected to Companion')
	mainAction.connectionStateChange()
	mainAction.subscribeAll()
})

connection.on('fillImage', (data) => {
	mainAction.receiveImage(data)
})

connection.on('clearAllKeys', () => {
	mainAction.clearAllDynamicKeys()
})

connection.on('subscribeError', (subId) => {
	mainAction.handleSubscribeError(subId)
})

connection.on('disconnect', () => {
	streamDeck.logger.info('Disconnected from Companion')
	mainAction.connectionStateChange()
})
