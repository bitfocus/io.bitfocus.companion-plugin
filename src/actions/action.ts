import streamDeck, {
	Action,
	action,
	ActionEvent,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	TitleParametersDidChangeEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from '@elgato/streamdeck'

import imageNotConnected from '../img/actionNotConnected.png'

import { connection, FillImageMessage } from '../companion-connection'
import { combineBankNumber, dataToImageUrl } from '../util'

interface KeyImageCache {
	listeners: Map<string, { action: Action<CompanionButtonSettings>; settings: CompanionButtonSettings }>
	cachedImage: string | null
}

/**
 * An example action class that displays a count that increments by one each time the button is pressed.
 */
@action({ UUID: 'io.bitfocus.companion-plugin.action' })
export class CompanionButtonAction extends SingletonAction<CompanionButtonSettings> {
	#keyImageListeners = new Map<string, KeyImageCache>()
	#actionItems = new Map<string, CompanionButtonSettings>()

	/**
	 * The {@link SingletonAction.onWillAppear} event is useful for setting the visual representation of an action when it become visible. This could be due to the Stream Deck first
	 * starting up, or the user navigating between pages / folders etc.. There is also an inverse of this event in the form of {@link streamDeck.client.onWillDisappear}. In this example,
	 * we're setting the title to the "count" that is incremented in {@link CompanionButtonAction.onKeyDown}.
	 */
	async onWillAppear(ev: WillAppearEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle(`${ev.payload.settings.count ?? 0}`)
		await ev.action.setImage(imageNotConnected)

		this.#actionItems.set(ev.action.id, ev.payload.settings)

		this.#subscribeAction(ev.action, ev.payload.settings)
	}

	async onWillDisappear(ev: WillDisappearEvent<CompanionButtonSettings>): Promise<void> {
		const settings = this.#actionItems.get(ev.action.id)
		this.#actionItems.delete(ev.action.id)

		if (settings) {
			this.#unsubscribeAction(ev.action, settings)
		}
	}

	/**
	 * Listens for the {@link SingletonAction.onKeyDown} event which is emitted by Stream Deck when an action is pressed. Stream Deck provides various events for tracking interaction
	 * with devices including key down/up, dial rotations, and device connectivity, etc. When triggered, {@link ev} object contains information about the event including any payloads
	 * and action information where applicable. In this example, our action will display a counter that increments by one each press. We track the current count on the action's persisted
	 * settings using `setSettings` and `getSettings`.
	 */
	async onKeyDown(ev: KeyDownEvent<CompanionButtonSettings>): Promise<void> {
		// Determine the current count from the settings.
		let page = ev.payload.settings.page ?? 0
		page++

		// Update the current count in the action's settings, and change the title.
		await ev.action.setSettings({ ...ev.payload.settings, page })
		await ev.action.setTitle(`${page}`)
	}

	async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle('')

		streamDeck.logger.debug(`got settings: ${JSON.stringify(ev)}`)

		// unsubscribe old settings
		const oldSettings = this.#actionItems.get(ev.action.id)
		if (oldSettings) this.#unsubscribeAction(ev.action, oldSettings)

		// subscribe new settings
		this.#actionItems.set(ev.action.id, ev.payload.settings)
		this.#subscribeAction(ev.action, ev.payload.settings)
	}

	async onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle('')
	}

	receiveImage(data: FillImageMessage) {
		const keyIndex = data.keyIndex
		const page = data.page

		const imageUrl = dataToImageUrl(data.data.data)

		if (page) {
			console.log('%cImage data for static button', 'border: 1px solid red', page, keyIndex)

			// 	for (const [actionItemId, actionItem] of Object.entries(actionItems)) {
			// 		if (actionItem.settings.buttonselector && page == actionItem.settings.pageselector) {
			// 			const pos = getKeyIndexFromCoordinate(actionItem.settings.buttonselector)

			// 			if (pos == keyIndex) {
			// 				imagecache[page + '_' + keyIndex] = imageUrl

			// 				console.log('sendCanvasToSD', actionItemId)
			// 				$SD.api.setImage(actionItemId, imageUrl, DestinationEnum.HARDWARE_AND_SOFTWARE)

			// 				$SD.api.setFeedback(actionItemId, {
			// 					canvas: imageUrl,
			// 				})
			// 			}
			// 		}
			// 	}
		} else {
			// 	// Cache all dynamic images
			// 	imagecache[keyIndex] = imageUrl
			// 	for (const [actionItemId, actionItem] of Object.entries(actionItems)) {
			// 		if (
			// 			actionItem.settings.buttonselector &&
			// 			(actionItem.settings.pageselector === 'dynamic' || !actionItem.settings.pageselector)
			// 		) {
			// 			const pos = getKeyIndexFromCoordinate(actionItem.settings.buttonselector)
			// 			if (pos == keyIndex) {
			// 				console.log('sendCanvasToSD', actionItemId)
			// 				$SD.api.setImage(actionItemId, imageUrl, DestinationEnum.HARDWARE_AND_SOFTWARE)
			// 				$SD.api.setFeedback(actionItemId, {
			// 					canvas: imageUrl,
			// 				})
			// 			}
			// 		}
			// 	}
		}
	}

	#subscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		// TODO: this
		// if (page === "dynamic") {
		// 	return;
		//   }

		const existing = this.#keyImageListeners.get(keyId)
		if (existing && existing.listeners.size > 0) {
			existing.listeners.set(action.id, { action, settings })

			// Draw cached image
			if (existing.cachedImage) {
				action.setImage(existing.cachedImage).catch(() => {
					// TODO
				})
			}
		} else {
			const newListeners: KeyImageCache = {
				listeners: new Map(),
				cachedImage: null,
			}
			newListeners.listeners.set(action.id, { action, settings })
			this.#keyImageListeners.set(keyId, newListeners)

			// send subscribe
			if (connection.isConnected) {
				const bankNumber = combineBankNumber(settings.row, settings.column)
				if (connection.supportsCoordinates) {
					connection.apicommand('request_button', { page: settings.page, row: settings.row, column: settings.column })
				} else if (bankNumber !== null) {
					connection.apicommand('request_button', { page: settings.page, bank: bankNumber })
				}
			}
		}
	}
	#unsubscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		// TODO - this
		// if (page === "dynamic") {
		// 	return;
		//   }

		const existing = this.#keyImageListeners.get(keyId)
		if (!existing) return

		existing.listeners.delete(action.id)

		if (existing.listeners.size === 0) {
			if (connection.isConnected) {
				const bankNumber = combineBankNumber(settings.row, settings.column)
				if (connection.supportsCoordinates) {
					connection.apicommand('unrequest_button', { page: settings.page, row: settings.row, column: settings.column })
				} else if (bankNumber !== null) {
					connection.apicommand('unrequest_button', { page: settings.page, bank: bankNumber })
				}
			}

			this.#keyImageListeners.delete(keyId)
		}
	}
}

function getKeyIdFromSettings(settings: CompanionButtonSettings) {
	// const coordinates = buttonselector.split(/:/);
	// return parseInt(coordinates[0]) - 1 + (parseInt(coordinates[1]) - 1) * 8;
	return `${settings.page}_${settings.row}_${settings.column}`
}

/**
 * Settings for {@link CompanionButtonAction}.
 */
type CompanionButtonSettings = {
	page: number
	row: number
	column: number
}
