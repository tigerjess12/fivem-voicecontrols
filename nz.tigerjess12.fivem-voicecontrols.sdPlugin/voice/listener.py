"""Offline push-to-talk recogniser (faster-whisper).

Commands on stdin: start | stop | quit | config <json>. Replies are JSON lines on stdout.
Audio is never written to disk unless debug is turned on in the plugin settings.
"""
import json
import os
import queue
import sys
import wave

RATE = 16000
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PROMPT = "Radio call."
settings = {"prompt": DEFAULT_PROMPT, "debug": False}


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    import numpy as np
    import sounddevice as sd
    from faster_whisper import WhisperModel
except ImportError as err:
    send({"type": "error", "code": "missing_packages", "message": str(err)})
    sys.exit(1)


def models_dir():
    """Per-user folder, so models survive plugin updates and are never bundled with the plugin."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "FiveM-VoiceControls", "models")


def load_model(name):
    root = models_dir()
    try:
        return WhisperModel(name, device="cpu", compute_type="int8", download_root=root, local_files_only=True)
    except Exception:
        send({"type": "downloading"})
        return WhisperModel(name, device="cpu", compute_type="int8", download_root=root)


def save_debug(samples):
    folder = os.path.join(HERE, "debug")
    os.makedirs(folder, exist_ok=True)
    with wave.open(os.path.join(folder, "last.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def transcribe(model, chunks):
    if not chunks:
        return ""
    samples = np.frombuffer(b"".join(chunks), dtype=np.int16)
    if settings["debug"]:
        save_debug(samples)
    audio = samples.astype(np.float32) / 32768.0
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak < 0.005:
        return ""
    audio = audio * min(0.9 / peak, 20.0)
    pad = np.zeros(RATE // 4, dtype=np.float32)
    audio = np.concatenate([pad, audio, pad])
    segments, _ = model.transcribe(audio, language="en", beam_size=1, initial_prompt=settings["prompt"], condition_on_previous_text=False, without_timestamps=True)
    return " ".join(s.text.strip() for s in segments).strip()


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "base.en"
    try:
        model = load_model(name)
        list(model.transcribe(np.zeros(RATE, dtype=np.float32), language="en", beam_size=1)[0])
    except Exception as err:
        send({"type": "error", "code": "model_failed", "message": str(err)})
        sys.exit(1)
    audio = queue.Queue()
    stream = None

    def callback(data, frames, time, status):
        audio.put(bytes(data))

    send({"type": "ready"})
    for line in sys.stdin:
        raw = line.strip()
        cmd = raw.lower()
        if cmd.startswith("config "):
            try:
                cfg = json.loads(raw[7:])
                settings["prompt"] = str(cfg.get("prompt") or DEFAULT_PROMPT)
                settings["debug"] = bool(cfg.get("debug"))
            except ValueError:
                pass
        elif cmd == "start" and stream is None:
            while not audio.empty():
                audio.get_nowait()
            try:
                stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=1600, callback=callback)
                stream.start()
            except Exception as err:
                stream = None
                send({"type": "error", "code": "no_mic", "message": str(err)})
        elif cmd == "stop" and stream is not None:
            stream.stop()
            stream.close()
            stream = None
            chunks = []
            while not audio.empty():
                chunks.append(audio.get_nowait())
            try:
                text = transcribe(model, chunks)
            except Exception as err:
                send({"type": "error", "code": "transcribe_failed", "message": str(err)})
                continue
            send({"type": "result", "text": text})
        elif cmd == "quit":
            break


if __name__ == "__main__":
    main()
