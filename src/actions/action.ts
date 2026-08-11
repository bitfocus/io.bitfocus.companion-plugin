import streamDeck, {
	Action,
	action,
	DialAction,
	DialDownEvent,
	DialRotateEvent,
	DialUpEvent,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	KeyUpEvent,
	PropertyInspectorDidAppearEvent,
	SingletonAction,
	TitleParametersDidChangeEvent,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from '@elgato/streamdeck'

import imageNotConnected from '../img/actionNotConnected.png'
import imageLoading from '../img/loadingIcon.png'

import { connection, FillImageMessage } from '../companion-connection'
import { dataToImageUrl, extractRowAndColumn } from '../util'

interface KeyImageCache {
	listeners: Map<string, { action: Action<CompanionButtonSettings> }>
	settings: CompanionButtonSettings
	cachedImage: string | null
}

const STREAM_DECK_PLUS_TOUCH_ROW = 2
const STREAM_DECK_PLUS_DIAL_ROW = 3

/**
 * An example action class that displays a count that increments by one each time the button is pressed.
 */
@action({ UUID: 'io.bitfocus.companion-plugin.action' })
export class CompanionButtonAction extends SingletonAction<CompanionButtonSettings> {
	#keyImageListeners = new Map<string, KeyImageCache>()
	#actionItems = new Map<
		string,
		{ action: Action<CompanionButtonSettings>; settings: CompanionButtonSettings; deviceId: string }
	>()

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

		// Ensure values are numbers
		ev.payload.settings.row = Number(ev.payload.settings.row) || 0
		ev.payload.settings.column = Number(ev.payload.settings.column) || 0
		ev.payload.settings.page = Number(ev.payload.settings.page) || 1

		await ev.action.setSettings(ev.payload.settings)

		const deviceId = ev.action.device.id
		connection.ensureDevice(deviceId, ev.action.device.name)
		this.#drawImage(ev.action, connection.isConnected(deviceId) ? imageLoading : imageNotConnected)

		this.#actionItems.set(ev.action.id, { action: ev.action, settings: ev.payload.settings, deviceId })

		this.#subscribeAction(deviceId, ev.action, this.#displaySettings(ev.action, ev.payload.settings))
	}

	async onWillDisappear(ev: WillDisappearEvent<CompanionButtonSettings>): Promise<void> {
		const actionItem = this.#actionItems.get(ev.action.id)
		this.#actionItems.delete(ev.action.id)

		if (actionItem) {
			this.#unsubscribeAction(
				actionItem.deviceId,
				actionItem.action,
				this.#displaySettings(actionItem.action, actionItem.settings)
			)

			const deviceStillInUse = [...this.#actionItems.values()].some((item) => item.deviceId === actionItem.deviceId)
			if (!deviceStillInUse) connection.removeDevice(actionItem.deviceId)
		}
	}

	async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<CompanionButtonSettings>): Promise<void> {
		this.#propertyInspectorConnectionStatus(ev.action.device.id)
	}

	#buttonEventPage(settings: CompanionButtonSettings): number | null {
		return settings.dynamicPage ? null : settings.page
	}

	async onKeyDown(ev: KeyDownEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyDown(ev.action.device.id, this.#buttonEventPage(s), s.row, s.column)
	}
	async onKeyUp(ev: KeyUpEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyUp(ev.action.device.id, this.#buttonEventPage(s), s.row, s.column)
	}
	async onDialRotate(ev: DialRotateEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.rotate(ev.action.device.id, this.#buttonEventPage(s), s.row, s.column, ev.payload.ticks)
	}
	async onDialDown(ev: DialDownEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyDown(ev.action.device.id, this.#buttonEventPage(s), s.row, s.column)
	}
	async onDialUp(ev: DialUpEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyUp(ev.action.device.id, this.#buttonEventPage(s), s.row, s.column)
	}
	async onTouchTap(ev: TouchTapEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		const row = s.row === STREAM_DECK_PLUS_DIAL_ROW ? STREAM_DECK_PLUS_TOUCH_ROW : s.row
		const page = this.#buttonEventPage(s)

		// Stream Deck sends touchTap as a completed gesture rather than separate
		// down/up events. Emit a complete Companion press for the LCD button.
		connection.keyDown(ev.action.device.id, page, row, s.column)
		connection.keyUp(ev.action.device.id, page, row, s.column)
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CompanionButtonSettings>): Promise<void> {
		//streamDeck.logger.setLevel(LogLevel.TRACE)

		streamDeck.logger.debug(`got settings: ${JSON.stringify(ev)}`)

		await ev.action.setTitle('')

		// Ensure values are numbers
		ev.payload.settings.row = Number(ev.payload.settings.row) || 0
		ev.payload.settings.column = Number(ev.payload.settings.column) || 0
		ev.payload.settings.page = Number(ev.payload.settings.page) || 1

		// unsubscribe old settings
		const oldActionItem = this.#actionItems.get(ev.action.id)
		if (oldActionItem) {
			this.#unsubscribeAction(
				oldActionItem.deviceId,
				ev.action,
				this.#displaySettings(ev.action, oldActionItem.settings)
			)
		}

		// subscribe new settings
		const deviceId = ev.action.device.id
		connection.ensureDevice(deviceId, ev.action.device.name)
		this.#actionItems.set(ev.action.id, { action: ev.action, settings: ev.payload.settings, deviceId })
		this.#subscribeAction(deviceId, ev.action, this.#displaySettings(ev.action, ev.payload.settings))
	}

	#displaySettings(
		action: Action<CompanionButtonSettings>,
		settings: CompanionButtonSettings
	): CompanionButtonSettings {
		// A Stream Deck + encoder occupies one SDK action slot for both its LCD
		// segment and physical dial. Companion convention uses row 3 for the LCD
		// navigation button and row 4 for the dial. Keep dial input on row 4 while
		// subscribing/drawing its paired LCD segment from row 3.
		if (action.isDial() && settings.row === STREAM_DECK_PLUS_DIAL_ROW) {
			return { ...settings, row: STREAM_DECK_PLUS_TOUCH_ROW }
		}

		return settings
	}

	async onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<CompanionButtonSettings>): Promise<void> {
		await ev.action.setTitle('')
	}

	receiveImage(deviceId: string, data: FillImageMessage) {
		// streamDeck.logger.debug(`got image: ${JSON.stringify(data)}`)

		const page = data.page

		streamDeck.logger.debug(`fillImage ${JSON.stringify({ ...data, data: null })}`)

		const coords = extractRowAndColumn(data)
		// streamDeck.logger.debug(`got draw at ${JSON.stringify(coords)} from ${JSON.stringify(data)}`)
		if (!coords) return
		const { row, column } = coords

		const imageUrl = data.png ? data.data : dataToImageUrl(data.data)

		const buttonSettings: CompanionButtonSettings = { dynamicPage: !page, page: page || 0, row, column }
		const keyId = getKeyIdFromSettings(deviceId, buttonSettings)

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

	clearAllDynamicKeys(deviceId: string) {
		for (const actionItem of this.#actionItems.values()) {
			if (actionItem.deviceId !== deviceId) continue
			if (!actionItem.settings.dynamicPage) continue
			this.#drawImage(actionItem.action, connection.isConnected(deviceId) ? imageLoading : imageNotConnected)
		}
	}

	handleSubscribeError(deviceId: string, subId: string | null) {
		if (subId) {
			// Specific subscription failed — find matching keyImageListeners entry
			const existing = this.#keyImageListeners.get(`${deviceId}/${subId}`)
			if (existing) {
				existing.cachedImage = null
				for (const listener of existing.listeners.values()) {
					this.#drawImage(listener.action, imageNotConnected)
				}
			}
		} else {
			// No SUBID — mark all static-page buttons as failed
			for (const actionItem of this.#actionItems.values()) {
				if (actionItem.deviceId !== deviceId) continue
				if (actionItem.settings.dynamicPage) continue
				this.#drawImage(actionItem.action, imageNotConnected)
			}
		}
	}

	subscribeAll(deviceId: string) {
		if (!connection.isConnected(deviceId)) return

		for (const [keyId, item] of this.#keyImageListeners) {
			if (!keyId.startsWith(`${deviceId}/`)) continue
			this.#sendSubscribeForSettings(deviceId, item.settings)
		}
	}
	connectionStateChange(deviceId: string) {
		for (const actionItem of this.#actionItems.values()) {
			if (actionItem.deviceId !== deviceId) continue
			// Static-page buttons with subscriptions unavailable cannot work
			if (!actionItem.settings.dynamicPage && connection.subscriptionsAvailable(deviceId) === false) {
				this.#drawImage(actionItem.action, imageNotConnected)
			} else {
				this.#drawImage(actionItem.action, connection.isConnected(deviceId) ? imageLoading : imageNotConnected)
			}
		}

		this.#propertyInspectorConnectionStatus(deviceId)
	}

	#propertyInspectorConnectionStatus(deviceId: string) {
		if (!streamDeck.ui.action) return
		if (streamDeck.ui.action.device.id !== deviceId) return

		let connectionStatus: string | null = connection.errorMessage(deviceId)
		if (!connectionStatus && !connection.isConnected(deviceId)) {
			connectionStatus = 'disconnected'
		} else if (connection.isConnected(deviceId)) {
			connectionStatus = 'connected'
		}

		streamDeck.settings
			.getGlobalSettings<import('../types/types').GlobalSettings>()
			.then((currentSettings) => {
				streamDeck.settings.setGlobalSettings({
					...currentSettings,
					connectionStatus: connectionStatus,
					subscriptionsAvailable: connection.subscriptionsAvailable(deviceId),
				})
			})
			.catch((e) => {
				streamDeck.logger.warn(`Failed to update connection status: ${e}`)
			})
	}

	#drawImage(action: Action<CompanionButtonSettings>, image: string) {
		if (action.isKey()) {
			let keyAction = action as KeyAction
			keyAction.setImage(image).catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else if (action.isDial()) {
			let dialAction = action as DialAction
			dialAction.setFeedback({ canvas: image }).catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else {
			streamDeck.logger.error(`Draw image failed`)
		}
	}

	#subscribeAction(deviceId: string, action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(deviceId, settings)

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
			this.#sendSubscribeForSettings(deviceId, settings)
		}
	}
	#sendSubscribeForSettings(deviceId: string, settings: CompanionButtonSettings) {
		if (connection.isConnected(deviceId)) {
			const page = settings.dynamicPage ? null : settings.page
			// Skip static-page subscriptions if the server doesn't support them
			if (!settings.dynamicPage && connection.subscriptionsAvailable(deviceId) === false) return
			streamDeck.logger.debug(`send subscribe: ${JSON.stringify(settings)}`)
			connection.requestButton(deviceId, page, settings.row, settings.column)
		}
	}
	#unsubscribeAction(deviceId: string, action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const keyId = getKeyIdFromSettings(deviceId, settings)

		this.#drawImage(action, connection.isConnected(deviceId) ? imageLoading : imageNotConnected)

		const existing = this.#keyImageListeners.get(keyId)
		if (!existing) return

		existing.listeners.delete(action.id)

		if (existing.listeners.size === 0) {
			if (connection.isConnected(deviceId)) {
				const page = settings.dynamicPage ? null : settings.page
				connection.unrequestButton(deviceId, page, settings.row, settings.column)
			}

			if (!settings.dynamicPage) {
				this.#keyImageListeners.delete(keyId)
			}
		}
	}
}

function getKeyIdFromSettings(deviceId: string, settings: CompanionButtonSettings) {
	// const coordinates = buttonselector.split(/:/);
	// return parseInt(coordinates[0]) - 1 + (parseInt(coordinates[1]) - 1) * 8;
	return `${deviceId}/${settings.dynamicPage ? 'dynamic' : settings.page}/${settings.row}/${settings.column}`
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
