// Voice command action for Stream Deck integration with FiveM voice controls
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {createInterface} from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, type KeyAction } from "@elgato/streamdeck";

// Connection managers for handling FiveM voice control connections
import { ConnectionManager, DEFAULT_HOST, DEFAULT_PORT } from "../connection";
import { parseVoiceTranscript } from "../voice-parser";


type Settings = { python?: string; model?: string; port?: number | string };
type View = { colour: string; line1: string; line2: string };

const LISTENER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../voice/listener.py");
const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const RESULT_MS = 2000;
const font = 'font-family="Segoe UI, Arial,sans-serif"';
const toDataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

class Listener {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private ready: Promise<void> | null = null;
    private pending: ((text:string | null) => void) | null = null;

    constructor(
        private readonly python: string,
        private readonly model: string
    ) {}

    async warm(): Promise<void> {
        await this.start().catch(() => undefined);
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
            let settled = false;
            this.pending = (text) => {
                if (!settled) {
                    settled = true;
                    resolve(text);
                }
            };
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.pending = null;
                resolve (null);
            }, 5000); // Timeout

            this.proc?.stdin.write("stop\n", () => {
                clearTimeout(timeout);
            })
        });
    }
        
}


@action({ UUID: "nz.tigerjess12.fivem-voicecontrols"})
    export class VoiceCommandAction extends SingletonAction<Settings> {
        private readonly keys = new Map<string, KeyAction<Settings>>();
        private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
        private readonly listeners = new Map<string, Listener>();
        private readonly connections = new Map<number, ConnectionManager>();

        // Map to store active key actions, timers, listeners, and connections for voice command handling
        override onWillAppear(ev: WillAppearEvent<Settings>): void {
            if (!ev.action.isKey()) return;
            this.keys.set(ev.action.id, ev.action);
		    void this.show(ev.action, { colour: "#1e1f22", line1: "VOICE", line2: "hold to talk" });
            void this.listener(ev.payload.settings).warm();
        }

        // Handle cleanup when the action disappears from the interface
        override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
            this.keys.delete(ev.action.id);
        }

        // Retrieve or create a listener instance based on the provided settings
	    private listener(settings: Settings): Listener {
	    	const python = settings.python || "python";
	    	const model = settings.model || "base.en";
	    	const id = `${python}|${model}`;
	    	let l = this.listeners.get(id);
	    	if (!l) {
	    		l = new Listener(python, model);
	    		this.listeners.set(id, l);
	    	}
	    	return l;
	    }

        // Handle the key down event for the voice command action
	    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
	    	clearTimeout(this.timers.get(ev.action.id));
	    	await this.show(ev.action as KeyAction<Settings>, { colour: "#a12828", line1: "LISTENING", line2: "release to send" });
	    	try {
	    		await this.listener(ev.payload.settings).begin();
	    	} catch {
	    		await this.result(ev.action as KeyAction<Settings>, { colour: "#7a4a00", line1: "NO MIC", line2: "check python/vosk" }, true);
	    	}
	    }

    	override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    		const key = ev.action as KeyAction<Settings>;
    		await this.show(key, { colour: "#2b3a8c", line1: "THINKING", line2: "" });
    		const settings = ev.payload.settings;
    		const text = await this.listener(settings).end().catch(() => null);
    		const command = text ? parseVoiceTranscript(text) : null;
    		if (!command) {
    			await this.result(key, { colour: "#7a4a00", line1: "NOT HEARD", line2: (text || "silence").slice(0, 18) }, true);
    			return;
    		}

    		const port = Number(settings.port) || DEFAULT_PORT;
    		let conn = this.connections.get(port);
    		if (!conn) {
    			conn = new ConnectionManager(DEFAULT_HOST, port);
    			this.connections.set(port, conn);
    		}
    		await conn.connect();
    		const ok = await conn.send(command);
    		await this.result(key, { colour: ok ? "#1f6f3a" : "#7a1f1f", line1: ok ? "SENT" : "NO GAME", line2: command }, !ok);
    	}

    	private async result(key: KeyAction<Settings>, view: View, alert: boolean): Promise<void> {
    		await this.show(key, view);
    		if (alert) await key.showAlert();
    		this.timers.set(
    			key.id,
    			setTimeout(() => void this.show(key, { colour: "#1e1f22", line1: "VOICE", line2: "hold to talk" }), RESULT_MS)
    		);
    	}

    	private async show(key: KeyAction<Settings>, v: View): Promise<void> {
    		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="${v.colour}"/><text x="36" y="31" text-anchor="middle" ${font} font-size="12" font-weight="700" fill="#fff">${esc(v.line1)}</text><text x="36" y="49" text-anchor="middle" ${font} font-size="9" fill="#e0e3ff">${esc(v.line2)}</text></svg>`;
    		await key.setTitle("").catch(() => undefined);
    		await key.setImage(toDataUri(svg)).catch(() => undefined);
    	}
}