import streamDeck from '@elgato/streamdeck'

// import './css/sdpi.css'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
// streamDeck.logger.setLevel(LogLevel.TRACE)

const pageField = document.querySelector<HTMLInputElement>('#page-field')!
const rowField = document.querySelector<HTMLInputElement>('#row-field')!
const columnField = document.querySelector<HTMLInputElement>('#column-field')!

console.log('inspector here')
streamDeck.onDidConnect((a, b) => {
	console.log('connect', a, b)

	let newSettings = {
		...b.payload.settings,
	}
	if (!newSettings.page) newSettings.page = 1
	if (!newSettings.row) newSettings.row = 0
	if (!newSettings.column) newSettings.column = 0

	pageField.value = newSettings.page + ''
	rowField.value = newSettings.row + ''
	columnField.value = newSettings.column + ''

	pageField.onchange = () => {
		const newPage = Number(pageField.value)
		if (isNaN(newPage)) return

		newSettings.page = newPage
		streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	}
	rowField.onchange = () => {
		const newRow = Number(rowField.value)
		if (isNaN(newRow)) return

		newSettings.row = newRow
		streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	}
	columnField.onchange = () => {
		const newColumn = Number(columnField.value)
		if (isNaN(newColumn)) return

		newSettings.column = newColumn
		streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	}
})

// streamDeck.settings.onDidReceiveSettings()

// streamDeck.ui.onDidAppear((e) => {
// 	streamDeck.logger.debug('appear', e)
// })
// streamDeck.ui.onDidDisappear((e) => {
// 	streamDeck.logger.debug('disappear', e)
// })

// // Finally, connect to the Stream Deck.
// streamDeck.connect()
