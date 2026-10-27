# FiveM Voice Controls

A Stream Deck plugin for sending FiveM commands by voice. Hold the key, speak, release. Speech is transcribed offline with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), turned into a command, and sent to the FiveM client console over TCP.

## How it works

1. **Key down:** starts recording from the default microphone.
2. **Key up:** stops recording, transcribes the audio, and parses the text.
3. The command is sent to the FiveM console (default `127.0.0.1:29200`).

The key shows its state: `LISTENING`, `THINKING`, `SENT`, `NO GAME`, `NOT HEARD`, or an error such as `NO MIC`.

### Commands

The default commands are `sam` (callsign) and `p` (digits):

| Say | Sends |
| --- | --- |
| "Sam Whiskey November Tango one one" | `sam WNT11` |
| "Sam Kilo eight" | `sam K8` |
| "P one two three four" | `p 1234` |

You can replace them with your own in the key's **Commands** setting, which takes a JSON list. Leave it empty to use the defaults.

```json
[
  { "say": ["sam", "sum", "same"], "send": "sam", "args": "callsign" },
  { "say": ["code", "coat"], "send": "code", "args": "digits" },
  { "say": ["panic"], "send": "panic", "args": "none" }
]
```

- `say`: words that trigger the command. Add likely mis-hearings.
- `send`: the console command to send.
- `args`: how the rest of the speech is read. `callsign` (letters then digits), `digits`, `text` (words as spoken) or `none`.

Spoken numbers and the NATO alphabet are normalised. Anything that matches no command is reported as `NOT HEARD`. An invalid list shows `BAD CONFIG` on the key. See [voice-parser.ts](src/voice-parser.ts).

## Requirements

- Stream Deck 7.1+ (Windows 10+ or macOS 12+)
- Node.js 24 and the Stream Deck CLI (`npm i -g @elgato/cli`) if building from source
- Python 3.9+ with the speech packages:

  ```
  pip install faster-whisper numpy sounddevice
  ```

  If Python isn't on your PATH, enter its full path in the **Python** setting. The key shows `NO PYTHON` when Python can't be found and `PIP INSTALL` when the packages are missing.

- A FiveM client with the console TCP port enabled

## Setup

```
npm install
streamdeck link nz.tigerjess12.fivem-voicecontrols.sdPlugin
npm run build
```

`streamdeck link` makes Stream Deck load the plugin directly from this folder, so builds take effect without copying files. For development, `npm run watch` rebuilds and restarts the plugin on every change.

Then drag **Voice Command** from the *FiveM-VoiceControls* category onto a key.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Python | `python` | Python executable that has the dependencies installed |
| Model | `base.en` | Whisper model size |
| Console port | `29200` | FiveM console port |
| Commands | built-in | JSON command list (see above) |
| Debug | off | Save the last recording to `voice/debug/last.wav` |

## Privacy

Speech recognition runs entirely on your PC. Audio is held in memory only and is never written to disk unless **Debug** is ticked.

## Speech model

The model is not bundled. On first use it is downloaded (about 150 MB for `base.en`) and the key shows `DOWNLOADING`. It is stored in `%APPDATA%\FiveM-VoiceControls\models` on Windows (`~/Library/Application Support/FiveM-VoiceControls/models` on macOS), so it survives plugin updates. Delete that folder to remove it.

## Project layout

- [src/plugin.ts](src/plugin.ts): plugin entry point
- [src/actions/voice-command.ts](src/actions/voice-command.ts): key action and Python listener process
- [src/voice-parser.ts](src/voice-parser.ts): command config and transcript parsing
- [src/connection.ts](src/connection.ts): FiveM console connection
- [nz.tigerjess12.fivem-voicecontrols.sdPlugin/voice/listener.py](nz.tigerjess12.fivem-voicecontrols.sdPlugin/voice/listener.py): push-to-talk recogniser
- [nz.tigerjess12.fivem-voicecontrols.sdPlugin/ui/voice-command.html](nz.tigerjess12.fivem-voicecontrols.sdPlugin/ui/voice-command.html): settings panel

## Troubleshooting

- **Changes don't appear in Stream Deck:** make sure the plugin is linked, not copied (`streamdeck link`), then restart the Stream Deck app.
- **`NO PYTHON` / `PIP INSTALL`:** see Requirements.
- **`MODEL FAIL`:** the model download failed. Check your internet connection and try again.
- **`NO MIC`:** the microphone couldn't be opened. Check your default input device and OS microphone permissions.
- **`NO GAME`:** FiveM isn't running or the console port doesn't match.
- Logs are in `nz.tigerjess12.fivem-voicecontrols.sdPlugin/logs`.
