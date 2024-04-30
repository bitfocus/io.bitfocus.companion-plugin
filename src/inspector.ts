import streamDeck from '@elgato/streamdeck'

// import './css/sdpi.css'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
// streamDeck.logger.setLevel(LogLevel.TRACE)

const dynamicPageField = document.querySelector<HTMLInputElement>('#dynamic-page-field')!
const pageFieldWrapper = document.querySelector<HTMLInputElement>('#page-wrapper')!
const pageField = document.querySelector<HTMLInputElement>('#page-field')!
// const dynamicPositionField = document.querySelector<HTMLInputElement>('#dynamic-position-field')!
// const rowFieldWrapper = document.querySelector<HTMLInputElement>('#row-wrapper')!
const rowField = document.querySelector<HTMLInputElement>('#row-field')!
// const columnFieldWrapper = document.querySelector<HTMLInputElement>('#column-wrapper')!
const columnField = document.querySelector<HTMLInputElement>('#column-field')!

function updateUiVisibility(settings: any) {
	pageFieldWrapper.style.display = settings.dynamicPage ? 'none' : ''

	// rowFieldWrapper.style.display = settings.dynamicPosition ? 'none' : ''
	// columnFieldWrapper.style.display = settings.dynamicPosition ? 'none' : ''
}

console.log('inspector here')
streamDeck.onDidConnect((a, b) => {
	console.log('connect', a, b)

	let newSettings = {
		...b.payload.settings,
	}
	if (!newSettings.page) newSettings.page = 1
	if (!newSettings.row) newSettings.row = 0
	if (!newSettings.column) newSettings.column = 0
	if (!newSettings.dynamicPage) newSettings.dynamicPage = false
	// if (!newSettings.dynamicPosition) newSettings.dynamicPosition = false

	pageField.value = newSettings.page + ''
	rowField.value = newSettings.row + ''
	columnField.value = newSettings.column + ''
	dynamicPageField.checked = !!newSettings.dynamicPage
	// dynamicPositionField.checked = !!newSettings.dynamicPosition
	updateUiVisibility(newSettings)

	dynamicPageField.onchange = () => {
		const newState = !!dynamicPageField.checked

		newSettings.dynamicPage = newState
		updateUiVisibility(newSettings)

		streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	}
	pageField.onchange = () => {
		const newPage = Number(pageField.value)
		if (isNaN(newPage)) return

		newSettings.page = newPage
		streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	}
	// dynamicPositionField.onchange = () => {
	// 	const newState = !!dynamicPositionField.checked

	// 	newSettings.dynamicPosition = newState
	// 	updateUiVisibility(newSettings)

	// 	streamDeck.settings.setSettings(newSettings) // TODO - handle promise
	// }
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
