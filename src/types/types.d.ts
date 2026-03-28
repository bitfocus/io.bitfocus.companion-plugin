export type ConnectionMode = 'satellite-tcp' | 'satellite-ws' | 'legacy'

export type GlobalSettings = {
	connectionMode?: ConnectionMode

	// Satellite TCP
	satelliteTcpHost: string
	satelliteTcpPort: number

	// Satellite WebSocket
	satelliteWsUrl: string

	// Satellite shared
	satelliteDeviceIdSuffix: string

	// Legacy
	ip: string
	port: number

	// Shared
	connectionStatus: string
}
