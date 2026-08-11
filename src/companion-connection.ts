import streamDeck from '@elgato/streamdeck'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { SatelliteClient, SatelliteFillImageData } from './satellite/client'
import { ConnectionMode } from './types/types'
import { createHash } from 'node:crypto'

export type FillImageMessage = {
	page: number | null
	bank: number | null
	keyIndex: number | undefined
	row: number | undefined
	column: number | undefined
} & ({ png: true; data: string } | { png: undefined; data: Buffer | { data: number[] } })

interface ConnectionManagerEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: FillImageMessage]
	clearAllKeys: []
	subscribeError: [subId: string | null]
}

interface MultiConnectionManagerEvents {
	connected: [deviceId: string]
	disconnect: [deviceId: string]
	wrongversion: [deviceId: string]
	fillImage: [deviceId: string, data: FillImageMessage]
	clearAllKeys: [deviceId: string]
	subscribeError: [deviceId: string, subId: string | null]
}

// ==================== Legacy Connection ====================

interface LegacyConnectionEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: FillImageMessage]
	clearAllKeys: []
	subscribeError: [subId: string | null]

	'version:result': [arg: { error?: string; version: number }]
	'new_device:result': [arg: { supportsPng?: boolean; supportsCoordinates?: boolean }]
}

class LegacyConnection extends EventEmitter<LegacyConnectionEvents> {
	#websocket: WebSocket | undefined

	address: string
	port: number

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null
	public readonly subscriptionsSupported: boolean = true
	#supportsCoordinates = true
	#reconnectTimer: ReturnType<typeof setInterval>

	private remote_version: number | null = null

	constructor(address: string, port: number) {
		super()
		this.address = address
		this.port = port

		this.#reconnectTimer = setInterval(() => {
			if (!this.#websocket || !this.isConnected) {
				streamDeck.logger.info('Legacy: not connected, trying to reconnect')
				this.connect()
			}
		}, 5000)
	}

	destroy(): void {
		clearInterval(this.#reconnectTimer)
		try {
			this.#websocket?.close()
		} catch (_e) {
			// ignore
		}
		this.#websocket = undefined
		this.isConnected = false
	}

	#apiCommand(command: string, args: any) {
		if (this.#websocket && this.#websocket.readyState === 1) {
			const sendStr = JSON.stringify({ command, arguments: args })
			streamDeck.logger.debug(`legacy send: ${sendStr}`)
			this.#websocket.send(sendStr)
		} else {
			console.warn('Could not send ' + command + ' when not connected')
		}
	}

	keyDown(page: number | null, row: number, column: number): void {
		if (this.#supportsCoordinates) {
			this.#apiCommand('keydown', { page, row, column })
		} else if (page === null) {
			const keyIndex = row * 8 + column
			this.#apiCommand('keydown', { keyIndex })
		} else {
			const bank = row * 8 + column
			this.#apiCommand('keydown', { page, bank })
		}
	}

	keyUp(page: number | null, row: number, column: number): void {
		if (this.#supportsCoordinates) {
			this.#apiCommand('keyup', { page, row, column })
		} else if (page === null) {
			const keyIndex = row * 8 + column
			this.#apiCommand('keyup', { keyIndex })
		} else {
			const bank = row * 8 + column
			this.#apiCommand('keyup', { page, bank })
		}
	}

	rotate(page: number | null, row: number, column: number, ticks: number): void {
		if (this.#supportsCoordinates) {
			this.#apiCommand('rotate', { page, row, column, ticks })
		} else if (page === null) {
			const keyIndex = row * 8 + column
			this.#apiCommand('rotate', { keyIndex, ticks })
		} else {
			const bank = row * 8 + column
			this.#apiCommand('rotate', { page, bank, ticks })
		}
	}

	requestButton(page: number | null, row: number, column: number): void {
		if (this.#supportsCoordinates) {
			this.#apiCommand('request_button', { page, row, column })
		} else if (page !== null) {
			const bank = row * 8 + column
			if (bank !== null) this.#apiCommand('request_button', { page, bank })
		}
		// dynamic + no coordinates: not supported
	}

	unrequestButton(page: number | null, row: number, column: number): void {
		if (this.#supportsCoordinates) {
			this.#apiCommand('unrequest_button', { page, row, column })
		} else if (page !== null) {
			const bank = row * 8 + column
			if (bank !== null) this.#apiCommand('unrequest_button', { page, bank })
		}
	}

	connect() {
		streamDeck.logger.info('Legacy: connecting to', this.address, this.port)

		try {
			if (this.#websocket !== undefined) {
				this.#websocket.close()
			}
		} catch (_e) {
			// ignore
		} finally {
			this.#websocket = undefined
		}

		const websocket = (this.#websocket = new WebSocket('ws://' + this.address + ':' + this.port))

		websocket.onopen = () => {
			streamDeck.logger.debug('Legacy: websocket connected')
			this.isConnected = true
			this.removeAllListeners('version:result')
			this.#apiCommand('version', { version: 2 })
			this.once('version:result', (args) => {
				if (args.error) {
					console.warn('Error connecting: ', args)
					return
				}
				this.remote_version = args.version

				if (this.remote_version === 1) {
					this.errorMessage = 'wrongversion'
					this.emit('wrongversion')
					websocket.close()
				} else {
					// Send new_device and wait for result before emitting connected
					this.removeAllListeners('new_device:result')
					this.#apiCommand('new_device', { id: 'temp_id', supportsPng: true, supportsCoordinates: true })
					this.once('new_device:result', (res) => {
						this.#supportsCoordinates = !!res.supportsCoordinates
						this.errorMessage = null
						this.emit('connected')
					})
				}
			})
		}

		websocket.onerror = (evt) => {
			streamDeck.logger.debug('Legacy: websocket error', evt)
		}

		websocket.onclose = (evt) => {
			streamDeck.logger.debug('Legacy: websocket closed', evt.code)
			this.isConnected = false
			this.errorMessage = null
			this.emit('disconnect')
		}

		websocket.onmessage = (evt) => {
			if (evt.data) {
				try {
					const data = JSON.parse(evt.data.toString())
					if (data.response !== undefined) {
						this.emit(`${data.response}:result` as any, data.arguments)
					} else {
						this.emit(data.command, data.arguments)
					}
				} catch (e) {
					streamDeck.logger.warn(`Legacy: cannot parse packet: ${evt.data}`, e)
				}
			}
		}
	}
}

// ==================== Connection Manager ====================

export type ConnectionOptions =
	| { mode: 'satellite-tcp'; host: string; port: number; deviceId: string; productName: string }
	| { mode: 'satellite-ws'; url: string; deviceId: string; productName: string }
	| { mode: 'legacy'; ip: string; port: number }

export type MultiConnectionOptions =
	| { mode: 'satellite-tcp'; host: string; port: number; deviceIdPrefix: string }
	| { mode: 'satellite-ws'; url: string; deviceIdPrefix: string }
	| { mode: 'legacy'; ip: string; port: number }

class ConnectionManager extends EventEmitter<ConnectionManagerEvents> {
	#impl: LegacyConnection | SatelliteClient | null = null
	#mode: ConnectionMode = 'legacy'

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null
	public subscriptionsAvailable = false

	destroy(): void {
		this.#impl?.removeAllListeners()
		this.#impl?.destroy()
		this.#impl = null
		this.isConnected = false
	}

	setConnectionMode(options: ConnectionOptions): void {
		// Tear down existing
		if (this.#impl) {
			streamDeck.logger.info(`ConnectionManager: tearing down existing ${this.#mode} connection`)
			this.#impl.removeAllListeners()
			this.#impl.destroy()
			this.#impl = null
		}

		this.isConnected = false
		this.errorMessage = null
		this.subscriptionsAvailable = false
		this.#mode = options.mode

		if (options.mode === 'legacy') {
			const legacy = new LegacyConnection(options.ip, options.port)
			this.#impl = legacy
			this.#wireEvents(legacy)
			legacy.connect()
		} else if (options.mode === 'satellite-tcp') {
			const client = new SatelliteClient(
				{ type: 'tcp', host: options.host, port: options.port },
				options.deviceId,
				options.productName
			)
			this.#impl = client
			this.#wireEvents(client)
			client.connect()
		} else if (options.mode === 'satellite-ws') {
			const client = new SatelliteClient({ type: 'ws', url: options.url }, options.deviceId, options.productName)
			this.#impl = client
			this.#wireEvents(client)
			client.connect()
		}
	}

	#wireEvents(impl: LegacyConnection | SatelliteClient): void {
		impl.on('connected', () => {
			streamDeck.logger.info(`ConnectionManager: connected (mode=${this.#mode})`)
			this.isConnected = true
			this.errorMessage = null
			this.subscriptionsAvailable = impl.subscriptionsSupported
			this.emit('connected')
		})
		impl.on('disconnect', () => {
			streamDeck.logger.info(`ConnectionManager: disconnected (mode=${this.#mode})`)
			this.isConnected = false
			this.emit('disconnect')
		})
		impl.on('wrongversion', () => {
			streamDeck.logger.warn(`ConnectionManager: wrong version (mode=${this.#mode})`)
			this.errorMessage = impl.errorMessage
			this.emit('wrongversion')
		})
		impl.on('fillImage', (data: any) => {
			if (impl instanceof SatelliteClient) {
				const satData = data as SatelliteFillImageData
				if (satData.data.startsWith('data:')) {
					// Compressed bitmap (API v1.12+): a self-describing data url (e.g. image/png)
					// that Stream Deck can render directly — pass it straight through, no decode
					this.emit('fillImage', {
						page: satData.page,
						bank: null,
						keyIndex: undefined,
						row: satData.row,
						column: satData.column,
						png: true,
						data: satData.data,
					})
				} else {
					// Raw RGB24 base64 — decode to bytes for dataToImageUrl
					const bytes = Buffer.from(satData.data, 'base64')
					this.emit('fillImage', {
						page: satData.page,
						bank: null,
						keyIndex: undefined,
						row: satData.row,
						column: satData.column,
						png: undefined,
						data: bytes,
					})
				}
			} else {
				this.emit('fillImage', data as FillImageMessage)
			}
		})
		impl.on('clearAllKeys', () => {
			this.emit('clearAllKeys')
		})
		impl.on('subscribeError', (subId: string | null) => {
			this.emit('subscribeError', subId)
		})
	}

	keyDown(page: number | null, row: number, column: number): void {
		if (this.#impl instanceof LegacyConnection) {
			this.#impl.keyDown(page, row, column)
		} else if (this.#impl instanceof SatelliteClient) {
			this.#impl.keyDown(page, row, column)
		}
	}

	keyUp(page: number | null, row: number, column: number): void {
		if (this.#impl instanceof LegacyConnection) {
			this.#impl.keyUp(page, row, column)
		} else if (this.#impl instanceof SatelliteClient) {
			this.#impl.keyUp(page, row, column)
		}
	}

	rotate(page: number | null, row: number, column: number, ticks: number): void {
		if (this.#impl instanceof LegacyConnection) {
			this.#impl.rotate(page, row, column, ticks)
		} else if (this.#impl instanceof SatelliteClient) {
			this.#impl.rotate(page, row, column, ticks)
		}
	}

	requestButton(page: number | null, row: number, column: number): void {
		if (this.#impl instanceof LegacyConnection) {
			this.#impl.requestButton(page, row, column)
		} else if (this.#impl instanceof SatelliteClient) {
			this.#impl.requestButton(page, row, column)
		}
	}

	unrequestButton(page: number | null, row: number, column: number): void {
		if (this.#impl instanceof LegacyConnection) {
			this.#impl.unrequestButton(page, row, column)
		} else if (this.#impl instanceof SatelliteClient) {
			this.#impl.unrequestButton(page, row, column)
		}
	}
}

type DeviceConnectionOptions =
	| { mode: 'satellite-tcp'; host: string; port: number; deviceId: string; productName: string }
	| { mode: 'satellite-ws'; url: string; deviceId: string; productName: string }
	| { mode: 'legacy'; ip: string; port: number }

/**
 * Maintains an independent Companion surface connection for every physical
 * Stream Deck that contains at least one Companion action.
 */
class MultiConnectionManager extends EventEmitter<MultiConnectionManagerEvents> {
	#connections = new Map<string, ConnectionManager>()
	#deviceNames = new Map<string, string>()
	#options: MultiConnectionOptions | null = null

	setConnectionMode(options: MultiConnectionOptions): void {
		this.#options = options
		for (const [deviceId, connection] of this.#connections) {
			connection.removeAllListeners()
			this.#configureConnection(deviceId, connection)
		}
	}

	ensureDevice(deviceId: string, productName: string): void {
		this.#deviceNames.set(deviceId, productName)
		if (this.#connections.has(deviceId)) return

		const deviceConnection = new ConnectionManager()
		this.#connections.set(deviceId, deviceConnection)
		this.#wireEvents(deviceId, deviceConnection)
		this.#configureConnection(deviceId, deviceConnection)
	}

	removeDevice(deviceId: string): void {
		const deviceConnection = this.#connections.get(deviceId)
		if (!deviceConnection) return
		deviceConnection.removeAllListeners()
		deviceConnection.destroy()
		this.#connections.delete(deviceId)
		this.#deviceNames.delete(deviceId)
	}

	reconnectAll(): void {
		if (!this.#options) {
			streamDeck.logger.warn('Manual reconnect ignored: connection settings are not available')
			return
		}

		streamDeck.logger.info(`Manual reconnect requested for ${this.#connections.size} Companion surfaces`)
		for (const [deviceId, deviceConnection] of this.#connections) {
			deviceConnection.removeAllListeners()
			this.#configureConnection(deviceId, deviceConnection)
		}
	}

	#configureConnection(deviceId: string, deviceConnection: ConnectionManager): void {
		if (!this.#options) return
		this.#wireEvents(deviceId, deviceConnection)
		deviceConnection.setConnectionMode(this.#deviceOptions(deviceId))
	}

	#deviceOptions(deviceId: string): DeviceConnectionOptions {
		if (!this.#options) throw new Error('Connection settings are not available')
		const options = this.#options
		if (options.mode === 'legacy') return options

		const stableDeviceSuffix = createHash('sha256').update(deviceId).digest('hex').slice(0, 12)
		const satelliteDeviceId = `${options.deviceIdPrefix}:${stableDeviceSuffix}`
		const productName = this.#deviceNames.get(deviceId) || 'Elgato Stream Deck'

		return options.mode === 'satellite-tcp'
			? { ...options, deviceId: satelliteDeviceId, productName }
			: { ...options, deviceId: satelliteDeviceId, productName }
	}

	#wireEvents(deviceId: string, deviceConnection: ConnectionManager): void {
		deviceConnection.removeAllListeners()
		deviceConnection.on('connected', () => this.emit('connected', deviceId))
		deviceConnection.on('disconnect', () => this.emit('disconnect', deviceId))
		deviceConnection.on('wrongversion', () => this.emit('wrongversion', deviceId))
		deviceConnection.on('fillImage', (data) => this.emit('fillImage', deviceId, data))
		deviceConnection.on('clearAllKeys', () => this.emit('clearAllKeys', deviceId))
		deviceConnection.on('subscribeError', (subId) => this.emit('subscribeError', deviceId, subId))
	}

	isConnected(deviceId: string): boolean {
		return this.#connections.get(deviceId)?.isConnected ?? false
	}

	errorMessage(deviceId: string): 'wrongversion' | null {
		return this.#connections.get(deviceId)?.errorMessage ?? null
	}

	subscriptionsAvailable(deviceId: string): boolean {
		return this.#connections.get(deviceId)?.subscriptionsAvailable ?? false
	}

	keyDown(deviceId: string, page: number | null, row: number, column: number): void {
		this.#connections.get(deviceId)?.keyDown(page, row, column)
	}
	keyUp(deviceId: string, page: number | null, row: number, column: number): void {
		this.#connections.get(deviceId)?.keyUp(page, row, column)
	}
	rotate(deviceId: string, page: number | null, row: number, column: number, ticks: number): void {
		this.#connections.get(deviceId)?.rotate(page, row, column, ticks)
	}
	requestButton(deviceId: string, page: number | null, row: number, column: number): void {
		this.#connections.get(deviceId)?.requestButton(page, row, column)
	}
	unrequestButton(deviceId: string, page: number | null, row: number, column: number): void {
		this.#connections.get(deviceId)?.unrequestButton(page, row, column)
	}
}

export const connection = new MultiConnectionManager()
