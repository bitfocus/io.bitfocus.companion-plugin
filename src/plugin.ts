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
	// 	for (let ctx in actionItems) {
	// 	  errorstate =
	// 		"You need to install Companion 2.4 or newer and enable support for this plugin in the Settings tab";
	// 	  sendConnectionState(ctx);
	// 	}
})

connection.on('connected', () => {
	streamDeck.logger.info('conneced')

	mainAction.connectionStateChange()

	// console.log('New device with plugin UUID: ', pluginUUID)
	// 	companionClient.removeAllListeners("new_device:result");
	connection.apicommand('new_device', { id: 'temp_id', supportsPng: true })
	connection.once('new_device:result', (res) => {
		console.log('New device result:', res)
		//   for (const key of keyImageListeners.keys()) {
		// 	let [page, bank] = key.split(/_/);
		// 	console.log(
		// 	  "%c Initial request_button",
		// 	  "border: 1px solid red",
		// 	  page,
		// 	  bank
		// 	);
		// 	companionClient.apicommand("request_button", { page, bank });
		//   }
	})
	// 	for (let actionItemId in actionItems) {
	// 	  sendConnectionState(actionItemId);
	// 	}

	mainAction.subscribeAll()
})

connection.on('fillImage', (data) => {
	// streamDeck.logger.debug('fillImage', data)

	mainAction.receiveImage(data)
})

connection.on('disconnect', () => {
	streamDeck.logger.info('disconneced')

	mainAction.connectionStateChange()

	// 	for (let actionItemId in actionItems) {
	// 	  redrawCachedImageForActionItem(actionItemId);
	// 	  sendConnectionState(actionItemId);
	// 	}
	// 	errorstate = undefined;
})

// connection.setAddress('10.42.13.140')
connection.setAddress('100.116.211.104')
// connection.setAddress('companion.ct.julus.uk')
connection.connect()

// streamDeck.
