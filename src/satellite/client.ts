import { EventEmitter } from 'node:events'
import {
	SatelliteLineBuffer,
	formatSatelliteMessage,
	parseLineParameters,
	splitSatelliteCommand,
	type ParsedParams,
	type SatelliteMessageArgs,
} from '@companion-app/satellite-protocol/codec'
import { MAX_LINE_LENGTH } from '@companion-app/satellite-protocol/constants'
import {
	getSatelliteFeatures,
	isApiVersionAtLeast,
	type SatelliteFeatureId,
} from '@companion-app/satellite-protocol/versions'
import streamDeck from '@elgato/streamdeck'
import {
	ICompanionSatelliteClient,
	CompanionSatelliteTcpClient,
	CompanionSatelliteWsClient,
	SomeConnectionDetails,
	formatConnectionUrl,
} from './clientImplementations'
import {
	WIDE_BITMAP,
	buildLayoutManifest,
	encodeBase64Json,
	parseControlId,
	parseSubId,
	useManifest,
	wideSubId,
} from './layout'

const RECONNECT_DELAY = 5000
// Coalesce wide-cell changes (eg a profile switch showing several dials at once) into one re-registration
const REREGISTER_DEBOUNCE = 300
const PING_INTERVAL = 100
const PING_UNACKED_LIMIT = 50
const MINIMUM_PROTOCOL_VERSION = '1.10.0'

// Compressed bitmap encodings we can render, in order of preference.
// Companion advertises which it can stream via the CAPS `BITMAP_FORMATS` field (API v1.12+).
// We negotiate the first of these that is available, falling back to raw `rgb` otherwise.
// `png` data urls are rendered directly by Stream Deck, so they need no decoding and avoid
// the expensive raw-RGB → PNG re-encode in `dataToImageUrl`. We don't request `webp` because
// Stream Deck cannot be relied upon to render webp data urls.
const PREFERRED_BITMAP_FORMATS = ['png'] as const

export interface SatelliteFillImageData {
	page: number | null
	row: number
	column: number
	data: string // raw RGB24 base64, or a `data:` url for compressed (png) bitmaps
	wide: boolean // bitmap is WIDE_BITMAP sized instead of square
	wideSub?: boolean // static page image for a wide dial subscription (undefined for dynamic pages)
}

interface SatelliteClientEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: SatelliteFillImageData]
	clearAllKeys: []
	log: [message: string]
	subscribeError: [subId: string | null]
}

interface TrackedSubscription {
	page: number
	row: number
	column: number
	wide: boolean
}

interface TrackedSurface {
	rows: number
	cols: number
}

export class SatelliteClient extends EventEmitter<SatelliteClientEvents> {
	#client: ICompanionSatelliteClient | null = null
	#connectionDetails: SomeConnectionDetails
	#deviceId: string
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null
	#pingInterval: ReturnType<typeof setInterval> | null = null
	#lineBuffer = new SatelliteLineBuffer(MAX_LINE_LENGTH)
	#unackedPings = 0
	#destroyed = false

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null

	// ApiVersion from BEGIN, and the features it (and CAPS) enable
	#apiVersion: string | null = null
	#features: Record<SatelliteFeatureId, boolean> = getSatelliteFeatures('0.0.0', null)
	// CAPS: compressed bitmap encodings Companion can stream (BITMAP_FORMATS, API v1.12+)
	#companionBitmapFormats: string[] = []
	// Deferred connection handshake (wait for CAPS after BEGIN)
	#pendingConnected = false
	#capsTimer: ReturnType<typeof setTimeout> | null = null

	// Surface tracking for dynamic pages
	#registeredSurface: TrackedSurface | null = null
	// Button subscriptions for static pages
	#subscriptions = new Map<string, TrackedSubscription>()
	// Dynamic button keys that have been requested
	#dynamicKeys = new Set<string>()
	// Dynamic button keys shown by a wide dial, registered with wide bitmaps in manifest mode
	#wideDynamicKeys = new Set<string>()
	// The wide keys in the manifest Companion currently has; bitmaps follow this until a re-register lands
	#registeredWideKeys = new Set<string>()
	// Whether the registered surface used a LAYOUT_MANIFEST, so controls are addressed by CONTROLID
	#manifestMode = false
	#reRegisterTimer: ReturnType<typeof setTimeout> | null = null

	get subscriptionsSupported(): boolean {
		return this.#features.subscriptions
	}

	/**
	 * The compressed bitmap encoding negotiated with Companion, or `rgb` if none is available.
	 * Compressed bitmaps arrive as self-describing data urls, raw `rgb` as base64 pixel data.
	 */
	get #negotiatedBitmapFormat(): 'rgb' | (typeof PREFERRED_BITMAP_FORMATS)[number] {
		for (const format of PREFERRED_BITMAP_FORMATS) {
			if (this.#companionBitmapFormats.includes(format)) return format
		}
		return 'rgb'
	}

	constructor(connectionDetails: SomeConnectionDetails, deviceId: string) {
		super()
		this.#connectionDetails = connectionDetails
		this.#deviceId = deviceId
	}

	connect(): void {
		this.#destroyed = false
		this.#initSocket()
	}

	destroy(): void {
		this.#destroyed = true
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = null
		}
		if (this.#pingInterval) {
			clearInterval(this.#pingInterval)
			this.#pingInterval = null
		}
		if (this.#capsTimer) {
			clearTimeout(this.#capsTimer)
			this.#capsTimer = null
		}
		this.#clearReRegisterTimer()
		if (this.#client) {
			this.#client.destroy()
			this.#client = null
		}
		this.isConnected = false
		this.#pendingConnected = false
	}

	#initSocket(): void {
		if (this.#destroyed) return

		if (this.#client) {
			this.#client.destroy()
			this.#client = null
		}

		this.#lineBuffer.clear()
		this.#unackedPings = 0
		this.isConnected = false

		streamDeck.logger.info(`Satellite: connecting to ${formatConnectionUrl(this.#connectionDetails)}`)

		const details = this.#connectionDetails
		const client =
			details.type === 'tcp'
				? new CompanionSatelliteTcpClient(details.host, details.port)
				: new CompanionSatelliteWsClient(details.url)

		this.#client = client

		client.on('error', (err) => {
			streamDeck.logger.warn(`Satellite connection error: ${err.message}`)
		})

		client.on('connect', () => {
			streamDeck.logger.info(`Satellite socket connected to ${formatConnectionUrl(this.#connectionDetails)}`)
			this.#unackedPings = 0

			// Start keepalive
			if (this.#pingInterval) clearInterval(this.#pingInterval)
			this.#pingInterval = setInterval(() => {
				if (this.#unackedPings > PING_UNACKED_LIMIT) {
					streamDeck.logger.warn('Ping unacked limit reached, reconnecting')
					this.#client?.destroy()
					return
				}
				this.#unackedPings++
				this.#sendMessage('PING', {})
			}, PING_INTERVAL)
		})

		client.on('data', (data) => {
			this.#handleReceivedData(data.toString())
		})

		client.on('close', () => {
			if (this.#pingInterval) {
				clearInterval(this.#pingInterval)
				this.#pingInterval = null
			}
			if (this.#capsTimer) {
				clearTimeout(this.#capsTimer)
				this.#capsTimer = null
			}
			this.#pendingConnected = false
			this.#clearReRegisterTimer()

			const wasConnected = this.isConnected
			this.isConnected = false
			this.#registeredSurface = null
			this.#manifestMode = false

			if (wasConnected) {
				streamDeck.logger.info(`Satellite: disconnected from ${formatConnectionUrl(this.#connectionDetails)}`)
				this.errorMessage = null
				this.emit('disconnect')
			} else {
				streamDeck.logger.debug(
					`Satellite: socket closed (was not connected) for ${formatConnectionUrl(this.#connectionDetails)}`
				)
			}

			// Schedule reconnect
			if (!this.#destroyed) {
				streamDeck.logger.info(`Satellite: reconnecting in ${RECONNECT_DELAY}ms…`)
				this.#reconnectTimer = setTimeout(() => {
					this.#reconnectTimer = null
					streamDeck.logger.info(`Satellite: attempting connection to ${formatConnectionUrl(this.#connectionDetails)}`)
					this.#initSocket()
				}, RECONNECT_DELAY)
			}
		})

		client.connect()
	}

	#handleReceivedData(data: string): void {
		const { lines, overflow } = this.#lineBuffer.push(data)
		for (const line of lines) {
			if (line.length > 0) this.#handleLine(line)
		}
		if (overflow) {
			streamDeck.logger.warn('Satellite: received line exceeded maximum length, reconnecting')
			this.#client?.destroy()
		}
	}

	#handleLine(line: string): void {
		const { command, body } = splitSatelliteCommand(line)
		const params = parseLineParameters(body)

		switch (command) {
			case 'BEGIN':
				this.#handleBegin(params)
				break
			case 'CAPS':
				this.#handleCaps(params)
				break
			case 'KEY-STATE':
				this.#handleState(params)
				break
			case 'SUB-STATE':
				this.#handleSubState(params)
				break
			case 'ADD-SUB':
				this.#handleAddSubResponse(params)
				break
			case 'KEYS-CLEAR':
				this.emit('clearAllKeys')
				break
			case 'PONG':
				this.#unackedPings = 0
				break
			case 'PING':
				this.#sendMessage('PONG', {})
				break
			default:
				streamDeck.logger.debug(`Satellite: unknown command "${command}"`)
				break
		}
	}

	#handleBegin(params: ParsedParams): void {
		const apiVersion = params['ApiVersion']
		if (typeof apiVersion !== 'string') {
			streamDeck.logger.warn('Satellite: missing ApiVersion in BEGIN')
			this.errorMessage = 'wrongversion'
			this.emit('wrongversion')
			this.#client?.destroy()
			return
		}

		if (!isApiVersionAtLeast(apiVersion, MINIMUM_PROTOCOL_VERSION)) {
			streamDeck.logger.warn(`Satellite: ApiVersion ${apiVersion} does not meet minimum ${MINIMUM_PROTOCOL_VERSION}`)
			this.errorMessage = 'wrongversion'
			this.emit('wrongversion')
			this.#client?.destroy()
			return
		}

		streamDeck.logger.info(`Satellite: BEGIN CompanionVersion=${params['CompanionVersion']} ApiVersion=${apiVersion}`)

		// Defer emitting connected until CAPS is received (or timeout fires)
		this.#pendingConnected = true
		this.#apiVersion = apiVersion
		this.#features = getSatelliteFeatures(apiVersion, null)
		this.#companionBitmapFormats = []
		this.errorMessage = null

		// Defensive fallback: if CAPS never arrives, complete connection after 500ms
		if (this.#capsTimer) clearTimeout(this.#capsTimer)
		this.#capsTimer = setTimeout(() => {
			this.#capsTimer = null
			streamDeck.logger.warn('Satellite: CAPS not received within timeout, completing connection without subscriptions')
			this.#completeConnection()
		}, 500)
	}

	#handleCaps(params: ParsedParams): void {
		if (this.#capsTimer) {
			clearTimeout(this.#capsTimer)
			this.#capsTimer = null
		}

		if (this.#apiVersion !== null) this.#features = getSatelliteFeatures(this.#apiVersion, params)
		streamDeck.logger.info(
			`Satellite: CAPS SUBSCRIPTIONS=${this.#features.subscriptions} ROTARY_AMOUNT=${this.#features.rotaryAmount}`
		)

		// BITMAP_FORMATS is a comma-separated list of bitmap encodings Companion can stream (API v1.12+)
		this.#companionBitmapFormats =
			typeof params['BITMAP_FORMATS'] === 'string'
				? params['BITMAP_FORMATS']
						.split(',')
						.map((f) => f.trim().toLowerCase())
						.filter(Boolean)
				: []
		const negotiatedBitmapFormat = this.#negotiatedBitmapFormat
		if (negotiatedBitmapFormat !== 'rgb') {
			streamDeck.logger.info(`Satellite: CAPS supports compressed bitmaps, using '${negotiatedBitmapFormat}'`)
		}

		this.#completeConnection()
	}

	#completeConnection(): void {
		if (!this.#pendingConnected) return
		this.#pendingConnected = false

		this.isConnected = true
		this.errorMessage = null

		// Re-register surface if we had dynamic keys
		if (this.#dynamicKeys.size > 0 || this.#wideDynamicKeys.size > 0) {
			this.#reRegisterSurface()
		}

		// Re-subscribe all tracked subscriptions (only if server supports it)
		if (this.#features.subscriptions) {
			for (const sub of this.#subscriptions.values()) {
				this.#sendSubscribe(sub.page, sub.row, sub.column, sub.wide)
			}
		}

		this.emit('connected')
	}

	#handleAddSubResponse(params: ParsedParams): void {
		// Response format: ADD-SUB OK or ADD-SUB ERROR SUBID=x MESSAGE="..."
		if (params['ERROR'] === true) {
			const subId = typeof params['SUBID'] === 'string' ? params['SUBID'] : null
			const message = typeof params['MESSAGE'] === 'string' ? params['MESSAGE'] : 'unknown error'
			streamDeck.logger.warn(`Satellite: ADD-SUB failed for SUBID=${subId}: ${message}`)
			this.emit('subscribeError', subId)
		}
	}

	// KEY-STATE for surface/dynamic page buttons
	#handleState(params: ParsedParams): void {
		const controlId = params['CONTROLID']
		const keyIndex = params['KEY']
		const bitmap = params['BITMAP']

		if (typeof bitmap !== 'string') return

		let row: number
		let column: number
		if (typeof controlId === 'string') {
			// Manifest mode addresses controls by CONTROLID (`row/column`)
			const coords = parseControlId(controlId)
			if (!coords) return
			;({ row, column } = coords)
		} else if (typeof keyIndex === 'string') {
			const cols = this.#registeredSurface?.cols ?? 8
			const idx = parseInt(keyIndex, 10)
			row = Math.floor(idx / cols)
			column = idx % cols
		} else {
			return
		}

		const wide = this.#manifestMode && this.#registeredWideKeys.has(`${row}/${column}`)

		streamDeck.logger.debug(
			`Satellite: KEY-STATE key=${controlId ?? keyIndex} row=${row} col=${column} wide=${wide} bitmapLen=${bitmap.length}`
		)

		this.emit('fillImage', {
			page: null,
			row,
			column,
			data: bitmap,
			wide,
		})
	}

	// SUB-STATE for subscribed static-page buttons
	#handleSubState(params: ParsedParams): void {
		const subId = params['SUBID']
		const bitmap = params['BITMAP']

		if (typeof subId !== 'string' || !subId || typeof bitmap !== 'string') return

		const parsed = parseSubId(subId)
		if (!parsed) return
		const { page, row, column } = parsed
		// A wide subscription only gets a wide bitmap when Companion supports non-square ones
		const wide = parsed.wide && this.#features.nonSquareBitmaps

		streamDeck.logger.debug(`Satellite: SUB-STATE subId=${subId} row=${row} col=${column} bitmapLen=${bitmap.length}`)

		this.emit('fillImage', {
			page,
			row,
			column,
			data: bitmap,
			wide,
			wideSub: parsed.wide,
		})
	}

	// === Surface management (dynamic page buttons) ===
	#ensureSurfaceSize(neededRows: number, neededCols: number): void {
		const minRows = Math.max(4, neededRows)
		const minCols = Math.max(8, neededCols)

		if (this.#registeredSurface && this.#registeredSurface.rows >= minRows && this.#registeredSurface.cols >= minCols) {
			return // already big enough
		}

		const rows = Math.max(minRows, this.#registeredSurface?.rows ?? 0)
		const cols = Math.max(minCols, this.#registeredSurface?.cols ?? 0)

		this.#registerSurface(rows, cols)
	}

	#registerSurface(rows: number, cols: number): void {
		// Remove existing surface if registered
		if (this.#registeredSurface) {
			this.#sendMessage('REMOVE-DEVICE', { DEVICEID: this.#deviceId })
		}

		this.#registeredSurface = { rows, cols }
		this.#manifestMode = useManifest(this.#features)
		this.#registeredWideKeys = this.#manifestMode ? new Set(this.#wideDynamicKeys) : new Set()

		// Per-control bitmap sizes need a LAYOUT_MANIFEST; otherwise describe a plain grid of square keys
		const layoutArgs: SatelliteMessageArgs = this.#manifestMode
			? { LAYOUT_MANIFEST: encodeBase64Json(buildLayoutManifest(rows, cols, this.#wideDynamicKeys)) }
			: { KEYS_TOTAL: rows * cols, KEYS_PER_ROW: cols, BITMAPS: 72 }

		this.#sendMessage('ADD-DEVICE', {
			DEVICEID: this.#deviceId,
			PRODUCT_NAME: 'Elgato Stream Deck Plugin',
			...layoutArgs,
			BRIGHTNESS: false,
			// Request a compressed bitmap encoding when one was negotiated (API v1.12+);
			// omitting it keeps Companion's default raw `rgb` encoding
			...this.#bitmapFormatArgs(),
		})
	}

	#scheduleReRegister(): void {
		if (!this.isConnected || !useManifest(this.#features)) return
		this.#clearReRegisterTimer()
		this.#reRegisterTimer = setTimeout(() => {
			this.#reRegisterTimer = null
			// Same grid, new manifest; #registerSurface removes the old registration first
			const surface = this.#registeredSurface
			if (this.isConnected && surface) this.#registerSurface(surface.rows, surface.cols)
		}, REREGISTER_DEBOUNCE)
	}

	#clearReRegisterTimer(): void {
		if (this.#reRegisterTimer) {
			clearTimeout(this.#reRegisterTimer)
			this.#reRegisterTimer = null
		}
	}

	// KEY or CONTROLID addressing a dynamic page control, depending on how the surface was registered
	#dynamicControlArgs(row: number, column: number): SatelliteMessageArgs {
		if (this.#manifestMode) return { CONTROLID: `${row}/${column}` }
		const cols = this.#registeredSurface?.cols ?? 8
		return { KEY: row * cols + column }
	}

	#subId(page: number, row: number, column: number, wide: boolean): string {
		return wide ? wideSubId(page, row, column) : `${page}/${row}/${column}`
	}

	#reRegisterSurface(): void {
		// Compute needed size from tracked dynamic keys (wide ones may outlive a square request for the same cell)
		let maxRow = 3
		let maxCol = 7
		for (const key of [...this.#dynamicKeys, ...this.#wideDynamicKeys]) {
			const parts = key.split('/')
			maxRow = Math.max(maxRow, parseInt(parts[0], 10))
			maxCol = Math.max(maxCol, parseInt(parts[1], 10))
		}
		this.#registeredSurface = null // force re-register
		this.#ensureSurfaceSize(maxRow + 1, maxCol + 1)
	}

	// === Button actions ===
	keyDown(page: number | null, row: number, column: number, wide = false): void {
		this.#sendPress(page, row, column, wide, true)
	}

	keyUp(page: number | null, row: number, column: number, wide = false): void {
		this.#sendPress(page, row, column, wide, false)
	}

	#sendPress(page: number | null, row: number, column: number, wide: boolean, pressed: boolean): void {
		if (page === null) {
			// Dynamic page: press on surface
			this.#sendMessage('KEY-PRESS', {
				DEVICEID: this.#deviceId,
				...this.#dynamicControlArgs(row, column),
				PRESSED: pressed,
			})
		} else if (this.#features.subscriptions) {
			// Static page: subscription press
			this.#sendMessage('SUB-PRESS', {
				SUBID: this.#subId(page, row, column, wide),
				PRESSED: pressed,
			})
		}
	}

	rotate(page: number | null, row: number, column: number, ticks: number, wide = false): void {
		if (ticks === 0) return

		if (this.#features.rotaryAmount) {
			// API v1.14+: a single message carrying the signed step count
			this.#sendRotate(page, row, column, ticks, wide)
		} else {
			// Older APIs: one message per step, DIRECTION=1 clockwise / 0 counter-clockwise
			const direction = ticks > 0 ? 1 : 0
			for (let i = 0; i < Math.abs(ticks); i++) {
				this.#sendRotate(page, row, column, direction, wide)
			}
		}
	}

	#sendRotate(page: number | null, row: number, column: number, direction: number, wide: boolean): void {
		if (page === null) {
			this.#sendMessage('KEY-ROTATE', {
				DEVICEID: this.#deviceId,
				...this.#dynamicControlArgs(row, column),
				DIRECTION: direction,
			})
		} else if (this.#features.subscriptions) {
			this.#sendMessage('SUB-ROTATE', {
				SUBID: this.#subId(page, row, column, wide),
				DIRECTION: direction,
			})
		}
	}

	// === Subscription management ===
	requestButton(page: number | null, row: number, column: number, wide = false): void {
		if (page === null) {
			// Dynamic: register surface key
			const key = `${row}/${column}`
			this.#dynamicKeys.add(key)
			const wideChanged = wide && !this.#wideDynamicKeys.has(key)
			if (wide) this.#wideDynamicKeys.add(key)
			if (this.isConnected) {
				this.#ensureSurfaceSize(row + 1, column + 1)
				if (wideChanged) this.#scheduleReRegister()
			}
		} else {
			// Static: subscribe to button (only if server supports subscriptions)
			const subId = this.#subId(page, row, column, wide)
			this.#subscriptions.set(subId, { page, row, column, wide })
			if (this.isConnected && this.#features.subscriptions) {
				this.#sendSubscribe(page, row, column, wide)
			}
		}
	}

	unrequestButton(page: number | null, row: number, column: number, wide = false): void {
		if (page === null) {
			const key = `${row}/${column}`
			if (wide) {
				// The cell goes back to square; a square button on it keeps its subscription
				if (this.#wideDynamicKeys.delete(key)) this.#scheduleReRegister()
			} else {
				this.#dynamicKeys.delete(key)
			}
			// Note: we don't shrink the surface, that would be disruptive
		} else {
			const subId = this.#subId(page, row, column, wide)
			this.#subscriptions.delete(subId)
			if (this.isConnected && this.#features.subscriptions) {
				this.#sendMessage('REMOVE-SUB', { SUBID: subId })
			}
		}
	}

	#sendSubscribe(page: number, row: number, column: number, wide: boolean): void {
		const location = `${page}/${row}/${column}`
		// A STYLE replaces BITMAP, letting the subscription ask for a non-square bitmap
		const styleArgs: SatelliteMessageArgs =
			wide && this.#features.nonSquareBitmaps ? { STYLE: encodeBase64Json({ bitmap: WIDE_BITMAP }) } : { BITMAP: 72 }
		this.#sendMessage('ADD-SUB', {
			SUBID: this.#subId(page, row, column, wide),
			LOCATION: location,
			...styleArgs,
			// Request the negotiated compressed bitmap encoding for this subscription (API v1.12+)
			...this.#bitmapFormatArgs(),
		})
	}

	// BITMAP_FORMAT parameter for ADD-DEVICE / ADD-SUB, or empty when no compressed
	// format was negotiated (keeping Companion's default raw `rgb` encoding).
	#bitmapFormatArgs(): SatelliteMessageArgs {
		const format = this.#negotiatedBitmapFormat
		return format !== 'rgb' ? { BITMAP_FORMAT: format } : {}
	}

	// === Message formatting ===
	#sendMessage(command: string, params: SatelliteMessageArgs): void {
		if (!this.#client?.connected) return

		this.#client.write(formatSatelliteMessage(command, null, null, params))
	}
}
