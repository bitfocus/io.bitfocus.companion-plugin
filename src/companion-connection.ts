import streamDeck from '@elgato/streamdeck'
import EventEmitter from 'eventemitter3'
import { WebSocket } from 'ws'

export type FillImageMessage = {
	page: number | null
	bank: number | null
	keyIndex: number | undefined
	row: number | undefined
	column: number | undefined
} & ({ png: true; data: string } | { png: undefined; data: { data: number[] } })

export type CompanionKeyAction =
	| {
			// Coordinates based
			page: number | null // null means dynamic
			row: number
			column: number
	  }
	| {
			// Old specific button
			page: number
			bank: number
	  }
	| {
			// Old dynamic button
			keyIndex: number
	  }

export type CompanionRequestMessage =
	| {
			// Coordinates format
			page: number | null
			row: number
			column: number
	  }
	| {
			// Old format
			page: number
			bank: number
	  }

interface CompanionConnectionEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: FillImageMessage]
	clearAllKeys: []

	'version:result': [arg: { error?: string; version: number }]
	'new_device:result': [arg: { supportsPng?: boolean; supportsCoordinates?: boolean }]
}
export interface CompanionConnectionMessages {
	version: { version: 2 }
	new_device: string | { id: string; supportsPng?: boolean; supportsCoordinates?: boolean }

	keydown: CompanionKeyAction
	keyup: CompanionKeyAction
	rotate: CompanionKeyAction & { ticks: number }

	request_button: CompanionRequestMessage
	unrequest_button: CompanionRequestMessage
}

class CompanionConnection extends EventEmitter<CompanionConnectionEvents> {
	#websocket: WebSocket | undefined

	address: string
	port: number

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null
	public supportsCoordinates = true // TODO - this doesn't make sense to reside here

	private remote_version: number | null = null

	constructor(address?: string, port?: number) {
		super()

		this.address = address || '127.0.0.1'
		this.port = port || 28492

		this.isConnected = false

		/* this.timer = */ setInterval(() => {
			if (!this.#websocket || !this.isConnected) {
				console.log('Not connected?')
				streamDeck.logger.info('Not connected, trying to reconnect')
				this.connect()
			}
		}, 5000)
	}

	setAddress(address: string): void {
		let oldAddress = this.address

		if (oldAddress !== this.address) {
			streamDeck.logger.info(`Setting address from ${oldAddress} to ${address}`)

			this.address = address
		}
	}

	setPort(port: number): void {
		let oldPort = this.port

		if (oldPort !== this.port) {
			streamDeck.logger.info(`Setting port from ${oldPort} to ${port}`)

			this.port = port
		}
	}

	apiCommand<T extends keyof CompanionConnectionMessages>(command: T, args: CompanionConnectionMessages[T]) {
		if (this.#websocket && this.#websocket.readyState == 1) {
			const sendStr = JSON.stringify({ command: command, arguments: args })
			streamDeck.logger.debug(`send: ${sendStr}`)
			this.#websocket.send(sendStr)
		} else {
			console.warn('Could not send ' + command + ' when not connected')
		}
	}

	connect() {
		console.log('cc: connect')
		streamDeck.logger.info('Connecting to Companion Instance at', this.address, this.port)
		let websocket: WebSocket
		
		try {
			if (this.#websocket !== undefined) {
				streamDeck.logger.debug('Closing existing websocket')
				this.#websocket.close()
			}
		}
		catch (e) {
			console.warn('Error closing websocket', e)
		}
		finally {
			this.#websocket = undefined
		}
		
		websocket = (this.#websocket = new WebSocket('ws://' + this.address + ':' + this.port))

		websocket.onopen = () => {
			// Websocket is connected
			console.log('[COMPANION]***** WEBSOCKET CONNECTED ****')
			streamDeck.logger.debug('Websocket connected')
			this.isConnected = true
			this.removeAllListeners('version:result')
			this.apiCommand('version', { version: 2 })
			this.once('version:result', (args) => {
				if (args.error) {
					console.warn('Error connecting: ', args)
					return
				}
				this.remote_version = args.version
				console.log('Version result:', args)

				if (this.remote_version === 1) {
					console.log('old version')
					this.errorMessage = 'wrongversion'
					this.emit('wrongversion')
					websocket.close()
				} else {
					console.log('connected')
					this.errorMessage = null
					this.emit('connected')
				}
			})
		}

		websocket.onerror = (evt) => {
			// @ts-ignore
			console.warn('WEBSOCKET ERROR', evt, evt.data)
			streamDeck.logger.debug('[COMPANION]***** WEBSOCKET ERROR ****', evt)
		}

		websocket.onclose = (evt) => {
			// Websocket is closed
			console.log('[COMPANION]***** WEBSOCKET CLOSED **** reason:', evt.code)
			streamDeck.logger.debug('Websocket closed', evt.code)

			this.isConnected = false
			this.errorMessage = null
			this.emit('disconnect')
		}

		websocket.onmessage = (evt) => {
			streamDeck.logger.trace(`receive ${evt.data}`)
			if (evt.data) {
				try {
					const data = JSON.parse(evt.data.toString())
					if (data.response !== undefined) {
						this.emit(`${data.response}:result` as any, data.arguments)
						console.log('Emitting response: ' + data.response)
					} else {
						this.emit(data.command, data.arguments)
					}
				} catch (e) {
					streamDeck.logger.warn(`Cannot parse wsapi packet: ${evt.data}`, e)
				}
			}
			//console.log("Got message: ", evt);
		}
	}
}

//export { CompanionConnection }
export const connection = new CompanionConnection()
