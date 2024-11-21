import { GlobalSettings } from './types/types'

import streamDeck, { LogLevel, DidReceiveGlobalSettingsEvent } from '@elgato/streamdeck'

import { connection } from './companion-connection'

import { CompanionButtonAction } from './actions/action'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.DEBUG)

// Register the actions.
const mainAction = new CompanionButtonAction()
streamDeck.actions.registerAction(mainAction)

// Finally, connect to the Stream Deck.
streamDeck.connect()

// Get the global settings
streamDeck.settings.getGlobalSettings()

// Global settings received
streamDeck.settings.onDidReceiveGlobalSettings((settings: DidReceiveGlobalSettingsEvent<GlobalSettings>) => {
	console.log('Got global settings:', settings)
	streamDeck.logger.info('Got global settings')
	streamDeck.logger.info(settings)

	let ip = settings.settings.ip
	streamDeck.logger.info('ip', ip)
	if (!ip) {
		ip = '127.0.0.1'
	}

	let port = settings.settings.port
	streamDeck.logger.info('port', port)
	if (!port) {
		port = 28492
	}

	let connectionStatus = settings.settings.connectionStatus
	if (!connectionStatus) {
		connectionStatus = ''
	}

	streamDeck.settings.setGlobalSettings({ ip: ip, port: port, connectionStatus: connectionStatus }).catch((e) => {
		streamDeck.logger.warn(`Failed to save global settings: ${e}`)
	})

	streamDeck.logger.info('Connecting to Companion at', ip, port)

	connection.setAddress(ip)
	connection.setPort(port)

	connection.connect()
})

connection.on('wrongversion', () => {
	streamDeck.logger.info('wrong version')

	mainAction.connectionStateChange()
})

connection.on('connected', () => {
	streamDeck.logger.info('Connected to Companion')

	mainAction.connectionStateChange()

	// console.log('New device with plugin UUID: ', pluginUUID)
	// 	companionClient.removeAllListeners("new_device:result");
	connection.apiCommand('new_device', { id: 'temp_id', supportsPng: true, supportsCoordinates: true })
	connection.once('new_device:result', (res) => {
		console.log('New device result:', res)

		connection.supportsCoordinates = !!res.supportsCoordinates

		mainAction.subscribeAll()
	})
})

connection.on('fillImage', (data) => {
	// streamDeck.logger.debug('fillImage', data)

	mainAction.receiveImage(data)
})

connection.on('clearAllKeys', () => {
	// streamDeck.logger.debug('clearAllKeys', data)

	mainAction.clearAllDynamicKeys()
})

connection.on('disconnect', () => {
	streamDeck.logger.info('Disconnected from Companion')

	mainAction.connectionStateChange()
})
