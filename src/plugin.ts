import streamDeck, { LogLevel } from '@elgato/streamdeck'

import { CompanionButtonAction } from './actions/action'

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE)

// Register the actions.
streamDeck.actions.registerAction(new CompanionButtonAction())

// Finally, connect to the Stream Deck.
streamDeck.connect()
