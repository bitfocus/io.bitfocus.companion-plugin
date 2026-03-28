// Adapted from companion-satellite's client.ts (battle-tested protocol handling)
import { EventEmitter } from 'node:events'
import { satisfies as semverSatisfies, gte as semverGte } from 'semver'
import streamDeck from '@elgato/streamdeck'
import {
	ICompanionSatelliteClient,
	CompanionSatelliteTcpClient,
	CompanionSatelliteWsClient,
	SomeConnectionDetails,
	formatConnectionUrl,
} from './clientImplementations'

const RECONNECT_DELAY = 5000
const PING_INTERVAL = 100
const PING_UNACKED_LIMIT = 50
const MINIMUM_PROTOCOL_VERSION = '1.10.0'

export interface SatelliteFillImageData {
	page: number | null
	row: number
	column: number
	data: string // raw RGB24 base64
}

interface SatelliteClientEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: SatelliteFillImageData]
	clearAllKeys: []
	log: [message: string]
}

interface TrackedSubscription {
	page: number
	row: number
	column: number
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
	#receivedBuffer = ''
	#unackedPings = 0
	#destroyed = false

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null

	// Surface tracking for dynamic pages
	#registeredSurface: TrackedSurface | null = null
	// Button subscriptions for static pages
	#subscriptions = new Map<string, TrackedSubscription>()
	// Dynamic button keys that have been requested
	#dynamicKeys = new Set<string>()

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
		if (this.#client) {
			this.#client.destroy()
			this.#client = null
		}
		this.isConnected = false
	}

	#initSocket(): void {
		if (this.#destroyed) return

		if (this.#client) {
			this.#client.destroy()
			this.#client = null
		}

		this.#receivedBuffer = ''
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

			const wasConnected = this.isConnected
			this.isConnected = false
			this.#registeredSurface = null

			if (wasConnected) {
				streamDeck.logger.info(`Satellite: disconnected from ${formatConnectionUrl(this.#connectionDetails)}`)
				this.errorMessage = null
				this.emit('disconnect')
			} else {
				streamDeck.logger.debug(`Satellite: socket closed (was not connected) for ${formatConnectionUrl(this.#connectionDetails)}`)
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

	// === Battle-tested line parser from companion-satellite ===
	#handleReceivedData(data: string): void {
		this.#receivedBuffer += data

		let i: number
		while ((i = this.#receivedBuffer.indexOf('\n')) !== -1) {
			const line = this.#receivedBuffer.substring(0, i).trim()
			this.#receivedBuffer = this.#receivedBuffer.substring(i + 1)

			if (line.length > 0) {
				this.#handleLine(line)
			}
		}
	}

	#handleLine(line: string): void {
		const spaceIdx = line.indexOf(' ')
		const command = spaceIdx === -1 ? line : line.substring(0, spaceIdx)
		const paramStr = spaceIdx === -1 ? '' : line.substring(spaceIdx + 1)
		const params = parseLineParameters(paramStr)

		switch (command) {
			case 'BEGIN':
				this.#handleBegin(params)
				break
			case 'KEY-STATE':
				this.#handleState(params)
				break
			case 'SUB-STATE':
				this.#handleSubState(params)
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

	#handleBegin(params: Record<string, string>): void {
		const apiVersion = params['ApiVersion']
		if (!apiVersion) {
			streamDeck.logger.warn('Satellite: missing ApiVersion in BEGIN')
			this.errorMessage = 'wrongversion'
			this.emit('wrongversion')
			this.#client?.destroy()
			return
		}

		if (!semverSatisfies(apiVersion, `>=${MINIMUM_PROTOCOL_VERSION}`, { includePrerelease: true })) {
			streamDeck.logger.warn(
				`Satellite: ApiVersion ${apiVersion} does not meet minimum ${MINIMUM_PROTOCOL_VERSION}`
			)
			this.errorMessage = 'wrongversion'
			this.emit('wrongversion')
			this.#client?.destroy()
			return
		}

		streamDeck.logger.info(
			`Satellite: BEGIN CompanionVersion=${params['CompanionVersion']} ApiVersion=${apiVersion}`
		)

		this.isConnected = true
		this.errorMessage = null

		// Re-register surface if we had dynamic keys
		if (this.#dynamicKeys.size > 0) {
			this.#reRegisterSurface()
		}

		// Re-subscribe all tracked subscriptions
		for (const sub of this.#subscriptions.values()) {
			this.#sendSubscribe(sub.page, sub.row, sub.column)
		}

		this.emit('connected')
	}

	// KEY-STATE for surface/dynamic page buttons
	#handleState(params: Record<string, string>): void {
		const keyIndex = params['KEY']
		const bitmap = params['BITMAP']

		if (keyIndex == null || bitmap == null) return

		const cols = this.#registeredSurface?.cols ?? 8
		const idx = parseInt(keyIndex, 10)
		const row = Math.floor(idx / cols)
		const column = idx % cols

		streamDeck.logger.debug(`Satellite: KEY-STATE key=${keyIndex} row=${row} col=${column} bitmapLen=${bitmap.length}`)

		this.emit('fillImage', {
			page: null,
			row,
			column,
			data: bitmap,
		})
	}

	// SUB-STATE for subscribed static-page buttons
	#handleSubState(params: Record<string, string>): void {
		const subId = params['SUBID']
		const bitmap = params['BITMAP']

		if (!subId || bitmap == null) return

		const parts = subId.split('/')
		if (parts.length !== 3) return

		const page = parseInt(parts[0], 10)
		const row = parseInt(parts[1], 10)
		const column = parseInt(parts[2], 10)

		streamDeck.logger.debug(`Satellite: SUB-STATE subId=${subId} row=${row} col=${column} bitmapLen=${bitmap.length}`)

		this.emit('fillImage', {
			page,
			row,
			column,
			data: bitmap,
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

		// Remove existing surface if registered
		if (this.#registeredSurface) {
			this.#sendMessage('REMOVE-DEVICE', { DEVICEID: this.#deviceId })
		}

		this.#registeredSurface = { rows, cols }
		this.#sendMessage('ADD-DEVICE', {
			DEVICEID: this.#deviceId,
			PRODUCT_NAME: 'Elgato Stream Deck Plugin',
			KEYS_TOTAL: String(rows * cols),
			KEYS_PER_ROW: String(cols),
			BITMAPS: '72',
			BRIGHTNESS: '0',
		})
	}

	#reRegisterSurface(): void {
		// Compute needed size from tracked dynamic keys
		let maxRow = 3
		let maxCol = 7
		for (const key of this.#dynamicKeys) {
			const parts = key.split('/')
			maxRow = Math.max(maxRow, parseInt(parts[0], 10))
			maxCol = Math.max(maxCol, parseInt(parts[1], 10))
		}
		this.#registeredSurface = null // force re-register
		this.#ensureSurfaceSize(maxRow + 1, maxCol + 1)
	}

	// === Button actions ===
	keyDown(page: number | null, row: number, column: number): void {
		if (page === null) {
			// Dynamic page: press on surface
			const cols = this.#registeredSurface?.cols ?? 8
			this.#sendMessage('KEY-PRESS', {
				DEVICEID: this.#deviceId,
				KEY: String(row * cols + column),
				PRESSED: 'true',
			})
		} else {
			// Static page: subscription press
			this.#sendMessage('SUB-PRESS', {
				SUBID: `${page}/${row}/${column}`,
				PRESSED: 'true',
			})
		}
	}

	keyUp(page: number | null, row: number, column: number): void {
		if (page === null) {
			const cols = this.#registeredSurface?.cols ?? 8
			this.#sendMessage('KEY-PRESS', {
				DEVICEID: this.#deviceId,
				KEY: String(row * cols + column),
				PRESSED: 'false',
			})
		} else {
			this.#sendMessage('SUB-PRESS', {
				SUBID: `${page}/${row}/${column}`,
				PRESSED: 'false',
			})
		}
	}

	rotate(page: number | null, row: number, column: number, ticks: number): void {
		const direction = ticks > 0 ? 'true' : 'false'
		const count = Math.abs(ticks)

		for (let i = 0; i < count; i++) {
			if (page === null) {
				const cols = this.#registeredSurface?.cols ?? 8
				this.#sendMessage('KEY-ROTATE', {
					DEVICEID: this.#deviceId,
					KEY: String(row * cols + column),
					DIRECTION: direction,
				})
			} else {
				this.#sendMessage('SUB-ROTATE', {
					SUBID: `${page}/${row}/${column}`,
					DIRECTION: direction,
				})
			}
		}
	}

	// === Subscription management ===
	requestButton(page: number | null, row: number, column: number): void {
		if (page === null) {
			// Dynamic: register surface key
			const key = `${row}/${column}`
			this.#dynamicKeys.add(key)
			if (this.isConnected) {
				this.#ensureSurfaceSize(row + 1, column + 1)
			}
		} else {
			// Static: subscribe to button
			const subId = `${page}/${row}/${column}`
			this.#subscriptions.set(subId, { page, row, column })
			if (this.isConnected) {
				this.#sendSubscribe(page, row, column)
			}
		}
	}

	unrequestButton(page: number | null, row: number, column: number): void {
		if (page === null) {
			const key = `${row}/${column}`
			this.#dynamicKeys.delete(key)
			// Note: we don't shrink the surface, that would be disruptive
		} else {
			const subId = `${page}/${row}/${column}`
			this.#subscriptions.delete(subId)
			if (this.isConnected) {
				this.#sendMessage('REMOVE-SUB', { SUBID: subId })
			}
		}
	}

	#sendSubscribe(page: number, row: number, column: number): void {
		const subId = `${page}/${row}/${column}`
		this.#sendMessage('ADD-SUB', {
			SUBID: subId,
			LOCATION: subId,
			BITMAP: '72',
		})
	}

	// === Message formatting (battle-tested from companion-satellite) ===
	#sendMessage(command: string, params: Record<string, string>): void {
		if (!this.#client?.connected) return

		let msg = command
		for (const [key, val] of Object.entries(params)) {
			// Quote values with spaces
			if (val.includes(' ')) {
				msg += ` ${key}="${val}"`
			} else {
				msg += ` ${key}=${val}`
			}
		}
		msg += '\n'

		this.#client.write(msg)
	}
}

// Battle-tested line parameter parser from companion-satellite
function parseLineParameters(line: string): Record<string, string> {
	const params: Record<string, string> = {}
	let remaining = line.trim()

	while (remaining.length > 0) {
		const equalsIndex = remaining.indexOf('=')
		if (equalsIndex === -1) break

		const key = remaining.substring(0, equalsIndex)
		remaining = remaining.substring(equalsIndex + 1)

		let value: string
		if (remaining.startsWith('"')) {
			// Quoted value
			const endQuote = remaining.indexOf('"', 1)
			if (endQuote === -1) {
				value = remaining.substring(1)
				remaining = ''
			} else {
				value = remaining.substring(1, endQuote)
				remaining = remaining.substring(endQuote + 1).trim()
			}
		} else {
			// Unquoted value
			const spaceIndex = remaining.indexOf(' ')
			if (spaceIndex === -1) {
				value = remaining
				remaining = ''
			} else {
				value = remaining.substring(0, spaceIndex)
				remaining = remaining.substring(spaceIndex + 1).trim()
			}
		}

		params[key] = value
	}

	return params
}
