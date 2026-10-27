// Voice command action for Stream Deck integration with FiveM voice controls
import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {createInterface} from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { action, KeyDownEvent, KeyUpEvent, SendToPluginEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, type KeyAction } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import streamDeck from "@elgato/streamdeck";

// Connection managers for handling FiveM voice control connections
import { ConnectionManager, DEFAULT_HOST, DEFAULT_PORT } from "../connection";
import { buildPrompt, parseCommandConfig, parseVoiceTranscript, type CommandRule } from "../voice-parser";


type Settings = { python?: string; model?: string; port?: number | string; commands?: string; debug?: boolean; microphone?: string };
type View = { colour: string; line1: string; line2: string };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LISTENER = path.resolve(HERE, "../voice/listener.py");
const BUNDLED = path.resolve(HERE, process.platform === "win32" ? "listener/listener.exe" : "listener/listener");

// The Full release ships a self-contained listener; otherwise fall back to the user's Python
function listenerCommand(python: string, args: string[]): { cmd: string; args: string[] } {
    return existsSync(BUNDLED) ? { cmd: BUNDLED, args } : { cmd: python, args: [LISTENER, ...args] };
}
const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const RESULT_MS = 2000;
const IDLE: View = { colour: "#1e1f22", line1: "VOICE", line2: "hold to talk" };

// Turns a listener failure into a message the user can act on
function errorView(err: unknown): View {
    const code = err instanceof LaunchError ? err.code : "";
    switch (code) {
        case "python_not_found":
            return { colour: "#7a4a00", line1: "NO PYTHON", line2: "set path" };
        case "missing_packages":
            return { colour: "#7a4a00", line1: "PIP INSTALL", line2: "see README" };
        case "model_failed":
            return { colour: "#7a4a00", line1: "MODEL FAIL", line2: "check internet" };
        default:
            return { colour: "#7a4a00", line1: "NO MIC", line2: "check mic" };
    }
}
const font = 'font-family="Segoe UI, Arial,sans-serif"';
const toDataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

class LaunchError extends Error {
    constructor(message: string, readonly code: string) {
        super(message);
    }
}

type ListenerConfig = { prompt: string; debug: boolean; mic: string };

// Asks the Python helper which microphones exist, for the settings dropdown
function listMicrophones(python: string): Promise<string[]> {
    return new Promise((resolve) => {
        const { cmd, args } = listenerCommand(python, ["--list-devices"]);
        execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
            if (err) return resolve([]);
            try {
                const msg = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "") as { devices?: string[] };
                resolve(Array.isArray(msg.devices) ? msg.devices : []);
            } catch {
                resolve([]);
            }
        });
    });
}

class Listener {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private ready: Promise<void> | null = null;
    private pending: ((text:string | null) => void) | null = null;
    private onStatus: ((status: string) => void) | null = null;

    constructor(
        private readonly python: string,
        private readonly model: string
    ) {}

    async warm(onStatus?: (status: string) => void): Promise<void> {
        await this.start(onStatus).catch(() => undefined);
    }

    private start(onStatus?: (status: string) => void): Promise<void> {
        if (onStatus) this.onStatus = onStatus;
        if (this.ready) return this.ready;
        this.ready = new Promise<void>((resolve, reject) => {
            const launch = listenerCommand(this.python, [this.model]);
            const proc = spawn(launch.cmd, launch.args, { windowsHide: true });
            this.proc = proc;
            proc.on("error", (err: NodeJS.ErrnoException) => {
                this.reset();
                reject(new LaunchError(err.message, err.code === "ENOENT" ? "python_not_found" : "spawn_failed"));
            });
            proc.on("close", (code) => {
                this.reset();
                reject(new LaunchError(`Process exited with code ${code}`, "exited"));
            });
            createInterface({ input: proc.stdout}).on("line", (line) => {
                try {
                    const msg = JSON.parse(line) as { type: string; text?: string; code?: string; message?: string };
                    if (msg.type === "ready") resolve();
                    else if (msg.type === "downloading") this.onStatus?.("downloading");
                    else if (msg.type === "result") this.finish(msg.text ?? "");
                    else if (msg.type === "error") {
                        reject(new LaunchError(msg.message ?? "Listener error", msg.code ?? "error"));
                        this.finish(null);
                    }
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

    async begin(config: ListenerConfig, onStatus?: (status: string) => void): Promise<void> {
        await this.start(onStatus);
        this.proc?.stdin.write(`config ${JSON.stringify(config)}\nstart\n`);
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
		    const key = ev.action;
		    void this.show(key, IDLE);
            void this.listener(ev.payload.settings)
                .warm((status) => void this.showStatus(key, status))
                .then(() => this.show(key, IDLE));
        }

        // Handle cleanup when the action disappears from the interface
        // Answers the settings panel's request for the microphone dropdown
        override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
            const payload = ev.payload as { event?: string } | null;
            if (payload?.event !== "getMicrophones") return;
            const settings = await ev.action.getSettings();
            const names = await listMicrophones(settings.python || "python");
            const items = [{ label: "System default", value: "default" }, ...names.map((n) => ({ label: n, value: n }))];
            await streamDeck.ui.sendToPropertyInspector({ event: "getMicrophones", items });
        }

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
	    	const key = ev.action as KeyAction<Settings>;
	    	clearTimeout(this.timers.get(key.id));
	    	let rules: CommandRule[];
	    	try {
	    		rules = parseCommandConfig(ev.payload.settings.commands);
	    	} catch (err) {
	    		await this.result(key, { colour: "#7a4a00", line1: "BAD CONFIG", line2: "see commands" }, true);
	    		streamDeck.logger.warn(`Invalid commands setting: ${err instanceof Error ? err.message : err}`);
	    		return;
	    	}
	    	await this.show(key, { colour: "#a12828", line1: "LISTENING", line2: "release to send" });
	    	try {
	    		await this.listener(ev.payload.settings).begin(
	    			{ prompt: buildPrompt(rules), debug: ev.payload.settings.debug === true, mic: ev.payload.settings.microphone ?? "" },
	    			(status) => void this.showStatus(key, status)
	    		);
	    	} catch (err) {
	    		await this.result(key, errorView(err), true);
	    	}
	    }

    	override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    		const key = ev.action as KeyAction<Settings>;
    		await this.show(key, { colour: "#2b3a8c", line1: "THINKING", line2: "" });
    		const settings = ev.payload.settings;
    		const text = await this.listener(settings).end().catch(() => null);
    		let command: string | null = null;
    		try {
    			command = text ? parseVoiceTranscript(text, parseCommandConfig(settings.commands)) : null;
    		} catch {
    			command = null;
    		}
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
    			setTimeout(() => void this.show(key, IDLE), RESULT_MS)
    		);
    	}

    	private async showStatus(key: KeyAction<Settings>, status: string): Promise<void> {
    		if (status === "downloading") await this.show(key, { colour: "#2b3a8c", line1: "DOWNLOADING", line2: "speech model" });
    	}

    	private async show(key: KeyAction<Settings>, v: View): Promise<void> {
    		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="${v.colour}"/><text x="36" y="31" text-anchor="middle" ${font} font-size="12" font-weight="700" fill="#fff">${esc(v.line1)}</text><text x="36" y="49" text-anchor="middle" ${font} font-size="9" fill="#e0e3ff">${esc(v.line2)}</text></svg>`;
    		await key.setTitle("").catch(() => undefined);
    		await key.setImage(toDataUri(svg)).catch(() => undefined);
    	}
}