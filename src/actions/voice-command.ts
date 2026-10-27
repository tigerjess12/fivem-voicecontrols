// Voice command action for Stream Deck integration with FiveM voice controls
import { ChildProcessWithoutNullStreams, spawn, type ChildProcess} from "node:child_process";
import {createInterface} from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, type KeyAction } from "@elgato/streamdeck";

// Connection managers for handling FiveM voice control connections
import { ConnectionManager, DEFAULT_HOST, DEFAULT_PORT } from "../connection";
import { parseVoiceTranscript } from "../voice-parser";


type Settings = { python?: string; model?: string; port?: number | string };
type View = { colour: string; line1: string; line2: string };

const LISTNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../voice/listener.py")
const RESULT_MS = 2000;
const font = 'font-family="Segoe UI, Arial,sans-serif"';

class Listener {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private ready: Promise<void> | null = null;
    private pending: ((text:string | null) => void) | null = null;

    constructor(
        private readonly python: string,
        private readonly model: string
    ) {}

    warm(): Promise<void> {
        return this.start().catch(() => undefined);
    }

    private start(): Promise<void> {
        if (this.ready) return this.ready;
        this.ready = new Promise<void>((resolve, reject) => {
            const proc = spawn(this.python, [LISTENER, this.model], { windowsHide: true });
            this.proc = proc;
            proc.on("error", (err) => {
                this.reset();
                reject(err);
            });
            proc.on("exit", (code) => {
                this.reset();
                reject(new Error(`Process exited with code ${code}`));
            });
            createInterface({ input: proc.stdout}).on("line", (line) => {
                try {
                    const msg = JSON.parse(line) as { type: string; text?: string };
                    if (msg.type === "ready") resolve();
                    else if (msg.type === "result") this.finish(msg.text ?? "");
                    else if (msg.type === "error") this.finish(null);
                } catch {
                    this.finish(null);
                }
            });
        });
        return this.ready;
    }

    private finish(text: string | null): void {
        const cb = this.pending;
        this.pending = null;
        if (cb) cb(text);
    }

    private reset() {
        this.proc = null;
        this.ready = null;
        this.finish(null);
    }

    async begin(): Promise<void> {
        await this.start();
        this.proc?.stdin.write("start\n");
    }

    async end(): Promise<string | null> {
        await this.start();
        return new Promise((resolve) => {
            this.pending = resolve;
            this.proc?.stdin.write("stop\n")
        });
    }
        
}