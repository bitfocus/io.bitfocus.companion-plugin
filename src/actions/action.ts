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
	WillAppearEvent,
	WillDisappearEvent,
} from '@elgato/streamdeck'

import imageNotConnected from '../img/actionNotConnected.png'
import imageLoading from '../img/loadingIcon.png'

import { connection, FillImageMessage } from '../companion-connection'
import { dataToImageUrl, extractRowAndColumn, isWideRawBitmap } from '../util'
import { imageKeyId, subIdToKeyId } from '../satellite/layout'

interface KeyImageCache {
	listeners: Map<string, { action: Action<CompanionButtonSettings> }>
	settings: CompanionButtonSettings
	cachedImage: string | null
	cachedWide: boolean
	// Entry for dials, which ask Companion for full-width bitmaps
	wide: boolean
}

/**
 * An example action class that displays a count that increments by one each time the button is pressed.
 */
@action({ UUID: 'io.bitfocus.companion-plugin.action' })
export class CompanionButtonAction extends SingletonAction<CompanionButtonSettings> {
	// Which layout each dial currently shows; manifest.json starts them on the square layout
	#dialLayoutWide = new Map<string, boolean>()
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

		// Ensure values are numbers
		ev.payload.settings.row = Number(ev.payload.settings.row) || 0
		ev.payload.settings.column = Number(ev.payload.settings.column) || 0
		ev.payload.settings.page = Number(ev.payload.settings.page) || 1

		await ev.action.setSettings(ev.payload.settings)

		this.#drawImage(ev.action, connection.isConnected ? imageLoading : imageNotConnected)

		this.#actionItems.set(ev.action.id, { action: ev.action, settings: ev.payload.settings })

		this.#subscribeAction(ev.action, ev.payload.settings)
	}

	async onWillDisappear(ev: WillDisappearEvent<CompanionButtonSettings>): Promise<void> {
		const actionItem = this.#actionItems.get(ev.action.id)
		this.#actionItems.delete(ev.action.id)
		this.#dialLayoutWide.delete(ev.action.id)

		if (actionItem) {
			this.#unsubscribeAction(actionItem.action, actionItem.settings)
		}
	}

	async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<CompanionButtonSettings>): Promise<void> {
		this.#propertyInspectorConnectionStatus()
	}

	#buttonEventPage(settings: CompanionButtonSettings): number | null {
		return settings.dynamicPage ? null : settings.page
	}

	async onKeyDown(ev: KeyDownEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyDown(this.#buttonEventPage(s), s.row, s.column, false)
	}
	async onKeyUp(ev: KeyUpEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyUp(this.#buttonEventPage(s), s.row, s.column, false)
	}
	async onDialRotate(ev: DialRotateEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.rotate(this.#buttonEventPage(s), s.row, s.column, ev.payload.ticks, true)
	}
	async onDialDown(ev: DialDownEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyDown(this.#buttonEventPage(s), s.row, s.column, true)
	}
	async onDialUp(ev: DialUpEvent<CompanionButtonSettings>): Promise<void> {
		const s = ev.payload.settings
		connection.keyUp(this.#buttonEventPage(s), s.row, s.column, true)
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

		const wide = data.png ? !!data.wide : isWideRawBitmap(data.data)
		const imageUrl = data.png ? data.data : wide ? dataToImageUrl(data.data, 200, 100) : dataToImageUrl(data.data)
		const cachePage = page || null

		// A static image belongs to one subscription; dynamic and legacy images serve keys and dials alike
		const entryWides = cachePage !== null && data.wideSub !== undefined ? [data.wideSub] : [false, true]
		for (const entryWide of entryWides) {
			const keyId = imageKeyId(cachePage, row, column, entryWide)
			const existing = this.#keyImageListeners.get(keyId)
			if (existing) {
				existing.cachedImage = String(imageUrl)
				existing.cachedWide = wide

				for (const actionItem of existing.listeners.values()) {
					this.#drawImage(actionItem.action, String(imageUrl), wide)
				}
			} else if (cachePage === null && !entryWide) {
				this.#keyImageListeners.set(keyId, {
					listeners: new Map(),
					settings: { dynamicPage: true, page: 0, row, column },
					cachedImage: String(imageUrl),
					cachedWide: wide,
					wide: false,
				})
			}
		}
	}

	clearAllDynamicKeys() {
		for (const actionItem of this.#actionItems.values()) {
			if (!actionItem.settings.dynamicPage) continue
			this.#drawImage(actionItem.action, connection.isConnected ? imageLoading : imageNotConnected)
		}
	}

	handleSubscribeError(subId: string | null) {
		if (subId) {
			// Specific subscription failed — find matching keyImageListeners entry
			const keyId = subIdToKeyId(subId)
			const existing = keyId ? this.#keyImageListeners.get(keyId) : undefined
			if (existing) {
				existing.cachedImage = null
				existing.cachedWide = false
				for (const listener of existing.listeners.values()) {
					this.#drawImage(listener.action, imageNotConnected)
				}
			}
		} else {
			// No SUBID — mark all static-page buttons as failed
			for (const actionItem of this.#actionItems.values()) {
				if (actionItem.settings.dynamicPage) continue
				this.#drawImage(actionItem.action, imageNotConnected)
			}
		}
	}

	subscribeAll() {
		if (!connection.isConnected) return

		for (const item of this.#keyImageListeners.values()) {
			// A dial entry left without dials must not mark its cell wide again
			if (item.wide && item.listeners.size === 0) continue
			this.#sendSubscribeForSettings(item.settings, item.wide)
		}
	}
	connectionStateChange() {
		for (const actionItem of this.#actionItems.values()) {
			// Static-page buttons with subscriptions unavailable cannot work
			if (!actionItem.settings.dynamicPage && connection.subscriptionsAvailable === false) {
				this.#drawImage(actionItem.action, imageNotConnected)
			} else {
				this.#drawImage(actionItem.action, connection.isConnected ? imageLoading : imageNotConnected)
			}
		}

		this.#propertyInspectorConnectionStatus()
	}

	#propertyInspectorConnectionStatus() {
		if (!streamDeck.ui.action) return

		let connectionStatus: string | null = connection.errorMessage
		if (!connectionStatus && !connection.isConnected) {
			connectionStatus = 'disconnected'
		} else if (connection.isConnected) {
			connectionStatus = 'connected'
		}

		streamDeck.settings
			.getGlobalSettings<import('../types/types').GlobalSettings>()
			.then((currentSettings) => {
				streamDeck.settings.setGlobalSettings({
					...currentSettings,
					connectionStatus: connectionStatus,
					subscriptionsAvailable: connection.subscriptionsAvailable,
				})
			})
			.catch((e) => {
				streamDeck.logger.warn(`Failed to update connection status: ${e}`)
			})
	}

	#drawImage(action: Action<CompanionButtonSettings>, image: string, wide = false) {
		if (action.isKey()) {
			let keyAction = action as KeyAction
			keyAction.setImage(image).catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else if (action.isDial()) {
			let dialAction = action as DialAction
			// A square image (icons, or a Companion without wide bitmaps) would be stretched by the wide layout
			const switchLayout = (this.#dialLayoutWide.get(action.id) ?? false) !== wide
			// Sent back to back (not chained) so a later draw can never overtake this one
			if (switchLayout) {
				this.#dialLayoutWide.set(action.id, wide)
				dialAction.setFeedbackLayout(wide ? 'wideEncoderLayout.json' : 'encoderLayout.json').catch((e) => {
					streamDeck.logger.error(`Set layout failed: ${e}`)
				})
			}
			dialAction.setFeedback({ canvas: image }).catch((e) => {
				streamDeck.logger.error(`Draw image failed: ${e}`)
			})
		} else {
			streamDeck.logger.error(`Draw image failed`)
		}
	}

	#subscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const wide = action.isDial()
		const keyId = imageKeyId(settings.dynamicPage ? null : settings.page, settings.row, settings.column, wide)

		streamDeck.logger.debug(`do sub ${keyId}`)

		const existing = this.#keyImageListeners.get(keyId)
		if (existing && (existing.listeners.size > 0 || settings.dynamicPage)) {
			// The first dial on a cell must mark it wide, even when an image is already cached for it
			if (wide && existing.listeners.size === 0) this.#sendSubscribeForSettings(settings, wide)
			existing.listeners.set(action.id, { action })

			// Draw cached image
			if (existing.cachedImage) {
				this.#drawImage(action, existing.cachedImage, existing.cachedWide)
			}
		} else {
			const newListeners: KeyImageCache = {
				listeners: new Map(),
				settings: { ...settings },
				cachedImage: null,
				cachedWide: false,
				wide,
			}
			newListeners.listeners.set(action.id, { action })
			this.#keyImageListeners.set(keyId, newListeners)

			// send subscribe
			this.#sendSubscribeForSettings(settings, wide)
		}
	}
	#sendSubscribeForSettings(settings: CompanionButtonSettings, wide: boolean) {
		if (connection.isConnected) {
			const page = settings.dynamicPage ? null : settings.page
			// Skip static-page subscriptions if the server doesn't support them
			if (!settings.dynamicPage && connection.subscriptionsAvailable === false) return
			streamDeck.logger.debug(`send subscribe: ${JSON.stringify(settings)}`)
			connection.requestButton(page, settings.row, settings.column, wide)
		}
	}
	#unsubscribeAction(action: Action<CompanionButtonSettings>, settings: CompanionButtonSettings) {
		const wide = action.isDial()
		const keyId = imageKeyId(settings.dynamicPage ? null : settings.page, settings.row, settings.column, wide)

		this.#drawImage(action, connection.isConnected ? imageLoading : imageNotConnected)

		const existing = this.#keyImageListeners.get(keyId)
		if (!existing) return

		existing.listeners.delete(action.id)

		if (existing.listeners.size === 0) {
			if (connection.isConnected) {
				const page = settings.dynamicPage ? null : settings.page
				connection.unrequestButton(page, settings.row, settings.column, wide)
			}

			if (!settings.dynamicPage) {
				this.#keyImageListeners.delete(keyId)
			}
		}
	}
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
