// Vendored from companion-satellite (battle-tested TCP/WS transports)
import { Socket as TCPSocket, createConnection as TCPcreateConnection } from 'net'
import { WebSocket } from 'ws'

export interface ICompanionSatelliteClient {
	readonly connected: boolean
	write(data: string): void
	destroy(): void
	connect(): void
	on(event: 'error', listener: (err: Error) => void): this
	on(event: 'connect', listener: () => void): this
	on(event: 'data', listener: (data: Buffer) => void): this
	on(event: 'close', listener: () => void): this
}

export type SomeConnectionDetails =
	| { type: 'tcp'; host: string; port: number }
	| { type: 'ws'; url: string }

export function formatConnectionUrl(connectionDetails: SomeConnectionDetails): string {
	switch (connectionDetails.type) {
		case 'tcp':
			return `tcp://${connectionDetails.host}:${connectionDetails.port}`
		case 'ws':
			return connectionDetails.url
		default:
			return 'Unknown'
	}
}

export class CompanionSatelliteTcpClient implements ICompanionSatelliteClient {
	#socket: TCPSocket | undefined
	#host: string
	#port: number

	#listeners: {
		error: ((err: Error) => void)[]
		connect: (() => void)[]
		data: ((data: Buffer) => void)[]
		close: (() => void)[]
	} = { error: [], connect: [], data: [], close: [] }

	constructor(host: string, port: number) {
		this.#host = host
		this.#port = port
	}

	get connected(): boolean {
		return !!this.#socket && !this.#socket.destroyed
	}

	write(data: string): void {
		this.#socket?.write(data)
	}

	destroy(): void {
		this.#socket?.destroy()
		this.#socket = undefined
	}

	connect(): void {
		this.destroy()
		const socket = (this.#socket = TCPcreateConnection(this.#port, this.#host))
		socket.on('error', (err) => this.#listeners.error.forEach((fn) => fn(err)))
		socket.on('connect', () => this.#listeners.connect.forEach((fn) => fn()))
		socket.on('data', (data) => this.#listeners.data.forEach((fn) => fn(data)))
		socket.on('close', () => this.#listeners.close.forEach((fn) => fn()))
	}

	on(event: 'error', listener: (err: Error) => void): this
	on(event: 'connect', listener: () => void): this
	on(event: 'data', listener: (data: Buffer) => void): this
	on(event: 'close', listener: () => void): this
	on(event: string, listener: (...args: any[]) => void): this {
		;(this.#listeners as any)[event]?.push(listener)
		return this
	}
}

export class CompanionSatelliteWsClient implements ICompanionSatelliteClient {
	#socket: WebSocket | undefined
	#url: string

	#listeners: {
		error: ((err: Error) => void)[]
		connect: (() => void)[]
		data: ((data: Buffer) => void)[]
		close: (() => void)[]
	} = { error: [], connect: [], data: [], close: [] }

	constructor(url: string) {
		this.#url = url
	}

	get connected(): boolean {
		return !!this.#socket && this.#socket.readyState === WebSocket.OPEN
	}

	write(data: string): void {
		this.#socket?.send(data)
	}

	destroy(): void {
		try {
			this.#socket?.close()
		} catch (_e) {
			// ignore
		}
		this.#socket = undefined
	}

	connect(): void {
		this.destroy()
		const socket = (this.#socket = new WebSocket(this.#url))
		socket.on('error', (err) => this.#listeners.error.forEach((fn) => fn(err)))
		socket.on('open', () => this.#listeners.connect.forEach((fn) => fn()))
		socket.on('message', (data) => this.#listeners.data.forEach((fn) => fn(data as Buffer)))
		socket.on('close', () => this.#listeners.close.forEach((fn) => fn()))
	}

	on(event: 'error', listener: (err: Error) => void): this
	on(event: 'connect', listener: () => void): this
	on(event: 'data', listener: (data: Buffer) => void): this
	on(event: 'close', listener: () => void): this
	on(event: string, listener: (...args: any[]) => void): this {
		;(this.#listeners as any)[event]?.push(listener)
		return this
	}
}
