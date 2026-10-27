import streamDeck from "@elgato/streamdeck";

import { VoiceCommandAction } from "./actions/voice-command";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the increment action.
streamDeck.actions.registerAction(new VoiceCommandAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
