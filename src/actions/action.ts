import streamDeck, {
	Action,
	action,
	//ActionEvent,
	DialAction,
	DialDownEvent,
	DialRotateEvent,
	DialUpEvent,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	KeyUpEvent,
	LogLevel,
	PropertyInspectorDidAppearEvent,
	PropertyInspectorDidDisappearEvent,
	SingletonAction,
	TitleParametersDidChangeEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from '@elgato/streamdeck'

import imageNotConnected from '../img/actionNotConnected.png'
import imageLoading from '../img/loadingIcon.png'

import { CompanionConnectionMessages, CompanionKeyAction, connection, FillImageMessage } from '../companion-connection'
import { bankIndexToRowAndColumn, combineBankNumber, dataToImageUrl, extractRowAndColumn } from '../util'

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

	override async onWillAppear(ev: WillAppearEvent<CompanionButtonSettings>): Promise<void> {
		streamDeck.logger.debug(`onWillAppear ${JSON.stringify(ev)}`)
		// ensure defaults are populated
		ev.payload.settings = {
			dynamicPage: true,
			page: 1,
			row: 0,
			column: 0,
			...(ev.payload.settings as Partial<CompanionButtonSettings>),
		}

		// Upgrade old buttons
		const oldPageSelector = (ev.payload.settings as any).pageselector
		delete (ev.payload.settings as any).pageselector
		if (oldPageSelector === 'dynamic') {
			ev.payload.settings.page = 1
			ev.payload.settings.dynamicPage = true
		} else if (oldPageSelector) {
			ev.payload.settings.page = Number(oldPageSelector) || ev.payload.settings.page
			ev.payload.settings.dynamicPage = false
		}
		const oldButtonSelector = (ev.payload.settings as any).buttonselector
		delete (ev.payload.settings as any).buttonselector
		if (typeof oldButtonSelector === 'string') {
			const coordinates = oldButtonSelector.split(/:/)
			ev.payload.settings.row = Number(coordinates[1]) - 1
			ev.payload.settings.column = Number(coordinates[0]) - 1
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
			this.#unsubscribeAction(actionItem.action, actionItem.settings)
		}
	}

	async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<CompanionButtonSettings>): Promise<void> {
		this.#propertyInspectorConnectionStatus()
	}

	#buttonEventProps(settings: CompanionButtonSettings): CompanionKeyAction | null {
		const page = settings.page
		const bank = combineBankNumber(settings.row, settings.column)

		console.log(settings.dynamicPage, page, bank)
		if (connection.supportsCoordinates) {
			return {
				page: settings.dynamicPage ? null : settings.page,
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

		connection.apiCommand('keydown', props)
	}
	async onKeyUp(ev: KeyUpEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apiCommand('keyup', props)
	}
	async onDialRotate(ev: DialRotateEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apiCommand('rotate', { ...props, ticks: ev.payload.ticks })
	}
	async onDialDown(ev: DialDownEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apiCommand('keydown', props)
	}
	async onDialUp(ev: DialUpEvent<CompanionButtonSettings>): Promise<void> {
		const props = this.#buttonEventProps(ev.payload.settings)
		if (!props) return

		connection.apiCommand('keyup', props)
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CompanionButtonSettings>): Promise<void> {
		//streamDeck.logger.setLevel(LogLevel.TRACE)

		streamDeck.logger.debug(`got settings: ${JSON.stringify(ev)}`)

		await ev.action.setTitle('')

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
			existing.cachedImage = String(imageUrl)

			for (const [actionItemId, actionItem] of existing.listeners.entries()) {
				this.#drawImage(actionItem.action, String(imageUrl))
			}
		} else if (buttonSettings.dynamicPage) {
			this.#keyImageListeners.set(keyId, {
				listeners: new Map(),
				settings: { ...buttonSettings },
				cachedImage: String(imageUrl),
			})
		}
	}

	clearAllDynamicKeys() {
		for (const actionItem of this.#actionItems.values()) {
			if (!actionItem.settings.dynamicPage) continue
			this.#drawImage(actionItem.action, connection.isConnected ? imageLoading : imageNotConnected)
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

		this.#propertyInspectorConnectionStatus()
	}

	#propertyInspectorConnectionStatus() {
		if (!streamDeck.ui.current) return

		let connectionStatus: string | null = connection.errorMessage
		if (!connectionStatus && !connection.isConnected) {
			connectionStatus = 'disconnected'
		} else if (connection.isConnected) {
			connectionStatus = 'connected'
		}

		streamDeck.settings.setGlobalSettings({
			ip: connection.address,
			port: connection.port,
			connectionStatus: connectionStatus,
		})
	}

	#drawImage(action: Action<CompanionButtonSettings>, image: string) {
		if (action.isKey()) {
			let keyAction = action as KeyAction
			keyAction.setImage(image)
			.catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else if (action.isDial()) {
			let dialAction = action as DialAction
			dialAction.setFeedback({ canvas: image })
			.catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else {
			streamDeck.logger.error(`Draw image failed`)
		}
	}

	#subscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		streamDeck.logger.debug(`do sub ${keyId}`)

		const existing = this.#keyImageListeners.get(keyId)
		if (existing && (existing.listeners.size > 0 || settings.dynamicPage)) {
			existing.listeners.set(action.id, { action })

			// Draw cached image
			if (existing.cachedImage) {
				this.#drawImage(action, existing.cachedImage)
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
		if (settings.dynamicPage && !connection.supportsCoordinates) return

		if (connection.isConnected) {
			const bankNumber = combineBankNumber(settings.row, settings.column)
			streamDeck.logger.debug(`send subscribe: ${JSON.stringify(settings)} ${bankNumber}`)
			if (connection.supportsCoordinates) {
				connection.apiCommand('request_button', {
					page: settings.dynamicPage ? null : settings.page,
					row: settings.row,
					column: settings.column,
				})
			} else if (bankNumber !== null) {
				connection.apiCommand('request_button', { page: settings.page, bank: bankNumber })
			}
		}
	}
	#unsubscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(settings)

		this.#drawImage(action, connection.isConnected ? imageLoading : imageNotConnected)

		const existing = this.#keyImageListeners.get(keyId)
		if (!existing) return

		existing.listeners.delete(action.id)

		if (existing.listeners.size === 0 && (!settings.dynamicPage || connection.supportsCoordinates)) {
			if (connection.isConnected) {
				const bankNumber = combineBankNumber(settings.row, settings.column)
				if (connection.supportsCoordinates) {
					connection.apiCommand('unrequest_button', { page: settings.page, row: settings.row, column: settings.column })
				} else if (bankNumber !== null) {
					connection.apiCommand('unrequest_button', { page: settings.page, bank: bankNumber })
				}
			}

			if (!settings.dynamicPage) {
				this.#keyImageListeners.delete(keyId)
			}
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
	row: number
	column: number
}
