import streamDeck, { LogLevel } from '@elgato/streamdeck'

import { connection } from './companion-connection'

import { CompanionButtonAction } from './actions/action'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.DEBUG)

// Register the actions.
const mainAction = new CompanionButtonAction()
streamDeck.actions.registerAction(mainAction)

// Finally, connect to the Stream Deck.
streamDeck.connect()

connection.on('wrongversion', () => {
	streamDeck.logger.info('wrong version')

	mainAction.connectionStateChange()
})

connection.on('connected', () => {
	streamDeck.logger.info('conneced')

	mainAction.connectionStateChange()

	// console.log('New device with plugin UUID: ', pluginUUID)
	// 	companionClient.removeAllListeners("new_device:result");
	connection.apicommand('new_device', { id: 'temp_id', supportsPng: true, supportsCoordinates: true })
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
	streamDeck.logger.info('disconneced')

	mainAction.connectionStateChange()
})

connection.connect()
