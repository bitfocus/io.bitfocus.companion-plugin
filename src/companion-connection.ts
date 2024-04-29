/*
 * This file is part of the Companion project
 * Copyright (c) 2019 Bitfocus AS
 * Authors: Håkon Nessjøen <haakon@bitfocus.io>, William Viker <william@bitfocus.io>
 *
 * This program is free software.
 * You should have received a copy of the MIT licence as well as the Bitfocus
 * Individual Contributor License Agreement for companion along with
 * this program.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the Companion software without
 * disclosing the source code of your own applications.
 *
 */

import EventEmitter from 'eventemitter3'

export interface FillImageMessage {
	page: number | null
	keyIndex: number | undefined
	data: { data: number[] }
}

interface CompanionConnectionEvents {
	connected: []
	disconnect: []
	wrongversion: []
	fillImage: [data: FillImageMessage]
}

class CompanionConnection extends EventEmitter<CompanionConnectionEvents> {
	websocket: WebSocket | undefined

	address: string | undefined

	isConnected = false
	supportsCoordinates = false // TODO - support this

	constructor(address?: string) {
		super()

		this.address = address
		this.isConnected = false

		/* this.timer = */ setInterval(() => {
			if (!this.websocket || !this.isConnected) {
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
	apicommand(command, args) {
		if (this.websocket && this.websocket.readyState == 1) {
			this.websocket.send(JSON.stringify({ command: command, arguments: args }))
		} else {
			console.warn('Could not send ' + command + ' when not connected')
		}
	}
	connect() {
		console.log('cc: connect')
		const websocket = (this.websocket = new WebSocket('ws://' + this.address + ':28492'))

		websocket.onopen = () => {
			this.isConnected = true
			this.removeAllListeners('version:result')
			this.apicommand('version', { version: 2 })
			this.once('version:result', (args) => {
				if (args.error) {
					console.warn('Error connecting: ', args)
				}
				this.remote_version = args.version
				console.log('Version result:', args)

				if (this.remote_version === 1) {
					console.log('old version')
					this.emit('wrongversion')
					websocket.close()
				} else {
					console.log('connected')
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
			this.emit('disconnect')
		}

		websocket.onmessage = (evt) => {
			if (evt.data) {
				try {
					const data = JSON.parse(evt.data)
					if (data.response !== undefined) {
						this.emit(data.response + ':result', data.arguments)
						console.log('Emitting response: ' + data.response)
					} else {
						this.emit(data.command, data.arguments)
					}
				} catch (e) {
					console.warn('Cannot parse wsapi packet:', evt.data, e)
				}
			}
			//console.log("Got message: ", evt);
		}
	}
}

export const connection = new CompanionConnection()
