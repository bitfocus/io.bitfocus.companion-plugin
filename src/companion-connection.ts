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

	public isConnected = false
	public errorMessage: 'wrongversion' | null = null
	public supportsCoordinates = true // TODO - this doesn't make sense to reside here

	private remote_version: number | null = null

	constructor(address?: string) {
		super()

		this.address = address || '127.0.0.1'
		this.isConnected = false

		/* this.timer = */ setInterval(() => {
			if (!this.#websocket || !this.isConnected) {
				console.log('Not connected?')
				this.connect()
			}
		}, 5000)
	}

	setAddress(address: string): void {
		console.log('cc: setAddress', address)

		this.address = address

		if (this.isConnected) {
			this.connect()
		}
	}

	apicommand<T extends keyof CompanionConnectionMessages>(command: T, args: CompanionConnectionMessages[T]) {
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
		const websocket = (this.#websocket = new WebSocket('ws://' + this.address + ':28492'))

		websocket.onopen = () => {
			this.isConnected = true
			this.removeAllListeners('version:result')
			this.apicommand('version', { version: 2 })
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
			console.warn('WEBOCKET ERROR', evt, evt.data)
		}

		websocket.onclose = (evt) => {
			// Websocket is closed
			console.log('[COMPANION]***** WEBOCKET CLOSED **** reason:', evt.code)

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

export const connection = new CompanionConnection()
