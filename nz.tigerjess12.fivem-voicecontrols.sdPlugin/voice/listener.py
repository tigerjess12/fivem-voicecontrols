"""Offline push-to-talk recogniser (faster-whisper). Commands on stdin: start | stop | quit. Replies are JSON lines on stdout."""
import json
import os
import queue
import sys
import wave

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

RATE = 16000
HERE = os.path.dirname(os.path.abspath(__file__))
PROMPT = "Police radio call. Sam W N T 1 1. Sam P O I 3. Sam K 8. 10-3 K8. 10-0 P O I 3. 10-2 A 4. 10-7 K 8. P 1 2 3 4. P 5 6 7. Postal 1 2 3 4."


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def save_debug(samples):
    with wave.open(os.path.join(HERE, "last.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def transcribe(model, chunks):
    if not chunks:
        return ""
    samples = np.frombuffer(b"".join(chunks), dtype=np.int16)
    save_debug(samples)
    audio = samples.astype(np.float32) / 32768.0
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak < 0.005:
        return ""
    audio = audio * min(0.9 / peak, 20.0)
    pad = np.zeros(RATE // 4, dtype=np.float32)
    audio = np.concatenate([pad, audio, pad])
    segments, _ = model.transcribe(audio, language="en", beam_size=1, initial_prompt=PROMPT, condition_on_previous_text=False, without_timestamps=True)
    return " ".join(s.text.strip() for s in segments).strip()


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "base.en"
    model = WhisperModel(name, device="cpu", compute_type="int8", download_root=os.path.join(HERE, "models"))
    list(model.transcribe(np.zeros(RATE, dtype=np.float32), language="en", beam_size=1)[0])
    audio = queue.Queue()
    stream = None

    def callback(data, frames, time, status):
        audio.put(bytes(data))

    send({"type": "ready"})
    for line in sys.stdin:
        cmd = line.strip().lower()
        if cmd == "start" and stream is None:
            while not audio.empty():
                audio.get_nowait()
            try:
                stream = sd.RawInputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=1600, callback=callback)
                stream.start()
            except Exception as err:
                stream = None
                send({"type": "error", "message": str(err)})
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
                send({"type": "error", "message": str(err)})
                continue
            with open(os.path.join(HERE, "last.txt"), "w", encoding="utf-8") as f:
                f.write(text)
            send({"type": "result", "text": text})
        elif cmd == "quit":
            break


if __name__ == "__main__":
    main()
