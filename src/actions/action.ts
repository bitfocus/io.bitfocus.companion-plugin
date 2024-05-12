import streamDeck, {
	Action,
	action,
	ActionEvent,
	DialDownEvent,
	DialRotateEvent,
	DialUpEvent,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	TitleParametersDidChangeEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from '@elgato/streamdeck'

import imageNotConnected from '../img/actionNotConnected.png'
import imageLoading from '../img/loadingIcon.png'

import { CompanionConnectionMessages, CompanionKeyAction, connection, FillImageMessage } from '../companion-connection'
import { combineBankNumber, dataToImageUrl, extractRowAndColumn } from '../util'

interface KeyImageCache {
	listeners: Map<string, { action: Action<CompanionButtonSettings> }>
	settings: CompanionButtonSettings
	cachedImage: string | null
}

/**
 * An example action class that displays a count that increments by one each time the button is pressed.
 */
@action({ UUID: 'io.bitfocus.companion-plugin.action' })
export class CompanionButtonAction extends SingletonAction<CompanionButtonSettings> {
	#keyImageListeners = new Map<string, KeyImageCache>()
	#actionItems = new Map<string, { action: Action<CompanionButtonSettings>; settings: CompanionButtonSettings }>()

	/**
	 * The {@link SingletonAction.onWillAppear} event is useful for setting the visual representation of an action when it become visible. This could be due to the Stream Deck first
	 * starting up, or the user navigating between pages / folders etc.. There is also an inverse of this event in the form of {@link streamDeck.client.onWillDisappear}. In this example,
	 * we're setting the title to the "count" that is incremented in {@link CompanionButtonAction.onKeyDown}.
	 */
	async onWillAppear(ev: WillAppearEvent<CompanionButtonSettings>): Promise<void> {
		// ensure defaults are populated
		ev.payload.settings = {
			dynamicPage: true,
			page: 1,
			// dynamicPosition: !ev.payload.settings.page, // default to true only for newly placed actions
			row: 0,
			column: 0,
			...(ev.payload.settings as Partial<CompanionButtonSettings>),
		}

		const oldPageSelector = (ev.payload.settings as any).pageselector
		delete (ev.payload.settings as any).pageselector
		if (oldPageSelector === 'dynamic') {
			ev.payload.settings.page = 1
			ev.payload.settings.dynamicPage = true
		} else if (oldPageSelector) {
			ev.payload.settings.page = Number(oldPageSelector) || ev.payload.settings.page
			ev.payload.settings.dynamicPage = false
		}
		const oldBankSelector = (ev.payload.settings as any).bankselector
		delete (ev.payload.settings as any).bankselector
		if (oldBankSelector) {
			// TODO
		}

		await ev.action.setSettings(ev.payload.settings)

		this.#drawImage(ev.action, connection.isConnected ? imageLoading : imageNotConnected)

		this.#actionItems.set(ev.action.id, { action: ev.action, settings: ev.payload.settings })

		this.#subscribeAction(ev.action, ev.payload.settings)
	}

	async onWillDisappear(ev: WillDisappearEvent<CompanionButtonSettings>): Promise<void> {
		const actionItem = this.#actionItems.get(ev.action.id)
		this.#actionItems.delete(ev.action.id)

		if (actionItem) {
			this.#unsubscribeAction(ev.action, actionItem.settings)
		}
	}

	#buttonEventProps(settings: CompanionButtonSettings): CompanionKeyAction | null {
		const page = settings.page
		const bank = combineBankNumber(settings.row, settings.column)

		console.log(name, settings.dynamicPage, page, bank)
		if (connection.supportsCoordinates) {
			return {
				page: settings.dynamicPage ? settings.page : null,
				row: settings.row,
				column: settings.column,
			}
		} else if (settings.dynamicPage && bank != null) {
			return { keyIndex: bank }
		} else if (bank != null) {
			return { page, bank }
		} else {
			return null
		}
	}

	async onKeyDown(ev: KeyDownEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apicommand('keydown', props)
	}
	async onKeyUp(ev: KeyUpEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apicommand('keyup', props)
	}
	async onDialRotate(ev: DialRotateEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apicommand('rotate', { ...props, ticks: ev.payload.ticks })
	}
	async onDialDown(ev: DialDownEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apicommand('keydown', props)
	}
	async onDialUp(ev: DialUpEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apicommand('keyup', props)
	}

	async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle('')

		streamDeck.logger.debug(`got settings: ${JSON.stringify(ev)}`)

		// unsubscribe old settings
		const oldActionItem = this.#actionItems.get(ev.action.id)
		if (oldActionItem) this.#unsubscribeAction(ev.action, oldActionItem.settings)

		// subscribe new settings
		this.#actionItems.set(ev.action.id, { action: ev.action, settings: ev.payload.settings })
		this.#subscribeAction(ev.action, ev.payload.settings)
	}

	async onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle('')
	}

	receiveImage(data: FillImageMessage) {
		// streamDeck.logger.debug(`got image: ${JSON.stringify(data)}`)

		const page = data.page

		streamDeck.logger.debug(`fillImage ${JSON.stringify({ ...data, data: null })}`)

		const coords = extractRowAndColumn(data)
		// streamDeck.logger.debug(`got draw at ${JSON.stringify(coords)} from ${JSON.stringify(data)}`)
		if (!coords) return
		const { row, column } = coords

		const imageUrl = data.png ? data.data : dataToImageUrl(data.data.data)

		const buttonSettings: CompanionButtonSettings = { dynamicPage: !page, page: page || 0, row, column }
		const keyId = getKeyIdFromSettings(buttonSettings)

		const existing = this.#keyImageListeners.get(keyId)
		if (existing) {
			existing.cachedImage = imageUrl

			for (const [actionItemId, actionItem] of existing.listeners.entries()) {
				this.#drawImage(actionItem.action, imageUrl).catch(() => {
					// TODO
				})
			}
		} else if (buttonSettings.dynamicPage) {
			this.#keyImageListeners.set(keyId, {
				listeners: new Map(),
				settings: { ...buttonSettings },
				cachedImage: imageUrl,
			})
		}
	}

	subscribeAll() {
		if (!connection.isConnected) return

		for (const item of this.#keyImageListeners.values()) {
			this.#sendSubscribeForSettings(item.settings)
		}
	}
	connectionStateChange() {
		for (const actionItem of this.#actionItems.values()) {
			this.#drawImage(actionItem.action, connection.isConnected ? imageLoading : imageNotConnected)
		}
	}

	async #drawImage(action: Action<CompanionButtonSettings>, image: string) {
		await action.setImage(image)
		await action.setFeedback({ canvas: image })
	}

	#subscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		streamDeck.logger.debug(`do sub ${keyId}`)

		const existing = this.#keyImageListeners.get(keyId)
		if (existing && (existing.listeners.size > 0 || settings.dynamicPage)) {
			existing.listeners.set(action.id, { action })

			// Draw cached image
			if (existing.cachedImage) {
				this.#drawImage(action, existing.cachedImage).catch(() => {
					// TODO
				})
			}
		} else {
			const newListeners: KeyImageCache = {
				listeners: new Map(),
				settings: { ...settings },
				cachedImage: null,
			}
			newListeners.listeners.set(action.id, { action })
			this.#keyImageListeners.set(keyId, newListeners)

			// send subscribe
			this.#sendSubscribeForSettings(settings)
		}
	}
	#sendSubscribeForSettings(settings: CompanionButtonSettings) {
		if (settings.dynamicPage) return

		if (connection.isConnected) {
			const bankNumber = combineBankNumber(settings.row, settings.column)
			streamDeck.logger.debug(`send subscribe: ${JSON.stringify(settings)} ${bankNumber}`)
			if (connection.supportsCoordinates) {
				connection.apicommand('request_button', { page: settings.page, row: settings.row, column: settings.column })
			} else if (bankNumber !== null) {
				connection.apicommand('request_button', { page: settings.page, bank: bankNumber })
			}
		}
	}
	#unsubscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		this.#drawImage(action, connection.isConnected ? imageLoading : imageNotConnected)

		const existing = this.#keyImageListeners.get(keyId)
		if (!existing) return

		existing.listeners.delete(action.id)

		if (existing.listeners.size === 0 && !settings.dynamicPage) {
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
	return `${settings.dynamicPage ? 'dynamic' : settings.page}/${settings.row}/${settings.column}`
}

/**
 * Settings for {@link CompanionButtonAction}.
 */
type CompanionButtonSettings = {
	dynamicPage: boolean
	page: number
	// dynamicPosition: boolean
	row: number
	column: number
}
