import streamDeck from '@elgato/streamdeck'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { SatelliteClient, SatelliteFillImageData } from './satellite/client'
import { ConnectionMode } from './types/types'

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
	| { mode: 'satellite-tcp'; host: string; port: number; deviceId: string }
	| { mode: 'satellite-ws'; url: string; deviceId: string }
	| { mode: 'legacy'; ip: string; port: number }

class ConnectionManager extends EventEmitter<ConnectionManagerEvents> {
	#impl: LegacyConnection | SatelliteClient | null = null
	#mode: ConnectionMode = 'legacy'

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null
	public subscriptionsAvailable = false

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
			const client = new SatelliteClient({ type: 'tcp', host: options.host, port: options.port }, options.deviceId)
			this.#impl = client
			this.#wireEvents(client)
			client.connect()
		} else if (options.mode === 'satellite-ws') {
			const client = new SatelliteClient({ type: 'ws', url: options.url }, options.deviceId)
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
				// Satellite BITMAP fields are raw RGB24 base64 — decode to bytes for dataToImageUrl
				const satData = data as SatelliteFillImageData
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

export const connection = new ConnectionManager()
