import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'

import { connection } from '../companion-connection'

type ReconnectSettings = Record<string, never>

/**
 * Reconnects every participating Stream Deck without registering the deck that
 * hosts this utility action as a Companion surface.
 */
@action({ UUID: 'io.bitfocus.companion-plugin.reconnect' })
export class ReconnectCompanionAction extends SingletonAction<ReconnectSettings> {
	override async onWillAppear(ev: WillAppearEvent<ReconnectSettings>): Promise<void> {
		await ev.action.setTitle('RECONNECT\nCOMPANION')
	}

	override async onKeyDown(_ev: KeyDownEvent<ReconnectSettings>): Promise<void> {
		connection.reconnectAll()
	}
}
