## What's changed

### Enhanced Speech Recognition & Customisation
- Added speech corrections and custom vocabulary settings in the UI to improve recognition accuracy and handle common misinterpretations.
- Implemented transcription confidence scoring in `listener.py`, allowing commands below a configurable confidence threshold to be rejected automatically.
- Improved speech normalisation with separate processing stages for corrections, spoken numbers, and NATO phonetic alphabet conversion.
- Added detailed parsing traces to help identify how individual words are interpreted.

### Expanded Voice Command Options
- Added support for additional argument types, including `plate` and `vehicle`, with improved validation.
- Added required argument settings and configurable minimum and maximum argument lengths.
- Introduced per-command cooldowns to prevent repeated commands from being triggered too frequently.
- Improved command matching to prioritise the longest matching trigger phrase, allowing more complex phrases and aliases.
- Improved callsign and registration validation to reject invalid or unreadable input.
- Updated the default QVR command to use plate recognition rather than callsign formatting.
- Improved handling of optional arguments, allowing commands to be triggered without additional information unless configured otherwise.

### Developer Experience & Documentation
- Introduced detailed parsing trace logs to make debugging easier and provide visibility into how commands are interpreted.
- Updated `README.md` with explanations, examples, and configuration details for the new command options.
- Added formal release notes and documented the updated release workflow.

### Compatibility & Behaviour
- Existing custom commands remain supported, although callsign arguments now use stricter validation.
- Improved handling of spoken letters and numbers, including retaining valid letters such as "A" when parsing registrations.
- Added clearer feedback for rejected commands, low-confidence transcriptions, and cooldowns.

---

Hold a Stream Deck key, say a command, and release. Your speech is transcribed locally on your PC and the resulting command is sent to the FiveM client console. Nothing is sent to the cloud.

## Release

### Which file do I download?

| File | Pick this if |
| --- | --- |
| **`fivem-voicecontrols-full.streamDeckPlugin`** | You don't have Python. Includes its own speech engine (about 110 MB). |
| **`fivem-voicecontrols-lite.streamDeckPlugin`** | You already have Python 3.9+. Smaller download, but you need to install the packages yourself: `pip install faster-whisper numpy sounddevice` |

### Install

1. Download one of the files above and double-click it. Stream Deck will install the plugin.
2. Drag **Voice Command** from the **FiveM-VoiceControls** category onto a key.
3. Hold the key, speak, and release.
4. The first press downloads the speech model (about 150 MB). The key displays `DOWNLOADING` while this happens.

### Features

- Push-to-talk speech recognition running entirely on your PC.
- Custom commands: define your own trigger phrases and FiveM console commands using JSON.
- Support for NATO phonetic alphabet, spoken numbers, and common mishearings.
- Speech corrections and custom vocabulary.
- Configurable argument types, validation, required arguments, and cooldowns.
- Configurable microphone selection.
- Transcription confidence threshold.
- Detailed parsing logs for troubleshooting.
- Key status indicators: `LISTENING`, `THINKING`, `SENT`, `NO GAME`, `NOT HEARD`, and error states.
- Audio is not saved unless Debug is enabled.

### Known issues

- **Windows only for now.** The Full version is built for Windows. macOS is currently untested.
- **Windows or antivirus warnings (Full version).** The bundled engine is not code-signed, so Windows may show an unknown publisher warning. Select **More info**, then **Run anyway**. Some antivirus tools may also remove it. If this happens, try the Lite version.
- FiveM must be running with its console port available (default `29200`), or the key will display `NO GAME`.

### Troubleshooting

| Key shows | Meaning |
| --- | --- |
| `NO PYTHON` | Lite only. Python wasn't found. Set its full path in the key's Python setting. |
| `PIP INSTALL` | Lite only. Required Python packages are missing. Run the `pip install` command above. |
| `MODEL FAIL` | The model download failed. Check your internet connection. |
| `NO MIC` | The microphone couldn't be opened. Check the Microphone setting and your OS microphone permissions. |
| `NO GAME` | FiveM isn't running, or the console port doesn't match. |
| `NOT HEARD` | Nothing matched a command. Enable Debug to see what was recognised. |
| `LOW CONF` | The transcription confidence was below your configured minimum. |
| `COOLDOWN` | The command was ignored because its cooldown period has not expired. |
| `BAD CONFIG` | The command configuration is invalid. Check your JSON settings. |

Full documentation is available in the [README](https://github.com/tigerjess12/fivem-voicecontrols#readme).

This is an unofficial community project and is not affiliated with FiveM, Cfx.re, or Elgato.

## Antivirus note

If your antivirus removes `listener.exe`, download `listener-windows.zip` from this release and extract it into the plugin's `bin\listener` folder, or add an exclusion for the file.