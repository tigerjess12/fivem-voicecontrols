// Dictionary spoken numbers to numeric string
const UNITS: Record<string, string> = {
    zero: "0", one: "1", won: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9",
    ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19"
};

// Dictionary spoken tens to numeric value
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Dictionary NATO phonetic alphabet to single letter mapping
const NATO: Record<string, string> = {
    alpha: "A", bravo: "B", charlie: "C", delta: "D", echo: "E", foxtrot: "F", golf: "G", hotel: "H", india: "I", juliett: "J", kilo: "K", lima: "L", mike: "M",
    november: "N", oscar: "O", papa: "P", quebec: "Q", romeo: "R", sierra: "S", tango: "T", uniform: "U", victor: "V", whiskey: "W", xray: "X", yankee: "Y", zulu: "Z"
};

/**
 * A spoken command. `say` lists the words that trigger it (include likely mis-hearings),
 * `send` is the console command that is sent, and `args` says how the rest of the speech is read:
 * - "callsign": letters then digits, e.g. "kilo eight" -> K8
 * - "digits": digits only, e.g. "one two three" -> 123
 * - "text": the words as spoken
 * - "none": no arguments
 */
export type CommandRule = { say: string[]; send: string; args?: "callsign" | "digits" | "text" | "none" };

export const DEFAULT_COMMANDS: CommandRule[] = [
    { say: ["sam", "sum", "sem", "same", "sand", "sans", "psalm", "salm"], send: "sam", args: "callsign" },
    { say: ["p", "pea", "pee"], send: "p", args: "digits" }
];

export const DEFAULT_COMMANDS_JSON = JSON.stringify(DEFAULT_COMMANDS, null, 2);

const ARG_TYPES = new Set(["callsign", "digits", "text", "none"]);

/** Parses the user's command list. Empty input means the defaults. Throws a readable error if invalid. */
export function parseCommandConfig(json: string | undefined): CommandRule[] {
    if (!json || !json.trim()) return DEFAULT_COMMANDS;
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data) || data.length === 0) throw new Error("Commands must be a non-empty list");
    return data.map((item, i) => {
        const r = item as Partial<CommandRule> | null;
        if (!r || !Array.isArray(r.say) || r.say.length === 0 || !r.say.every((s) => typeof s === "string" && s.trim())) {
            throw new Error(`Command ${i + 1}: "say" must be a list of words`);
        }
        if (typeof r.send !== "string" || !r.send.trim() || /[\r\n;]/.test(r.send)) {
            throw new Error(`Command ${i + 1}: "send" must be a single command`);
        }
        if (r.args !== undefined && !ARG_TYPES.has(r.args)) {
            throw new Error(`Command ${i + 1}: "args" must be callsign, digits, text or none`);
        }
        return { say: r.say.map((s) => s.trim().toLowerCase()), send: r.send.trim(), args: r.args ?? "text" };
    });
}

/** A short example phrase list that biases the speech recogniser towards the configured commands. */
export function buildPrompt(rules: CommandRule[]): string {
    const examples = rules.map((r) => {
        const word = r.say[0];
        if (r.args === "callsign") return `${word} K 8. ${word} W N T 1 1.`;
        if (r.args === "digits") return `${word} 1 2 3 4.`;
        return `${word}.`;
    });
    return `Radio call. ${examples.join(" ")}`;
}

// Normalize transcript into array of tokens
function normalize(transcript: string): string[] {
    // lowercase, remove non-alphanumeric characters except spaces, split into words, and filter out empty strings
    const speech = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

    const out: string[] = [];
    for (let i = 0; i < speech.length; i++) {
        const w = speech[i];
        // Check if the word is a spoken tens, units, or NATO phonetic letter
        if (w in TENS) {
            const next = UNITS[speech[i + 1]];
            if (next && next.length === 1 && next !== "0") {
                out.push(String(TENS[w] + Number(next)));
                i++; 
            } else {
                out.push(String(TENS[w]));
            }
        } else if (w in UNITS) {
            out.push(UNITS[w]);
        } else if (w in NATO) {
            out.push(NATO[w]);
        } else {
            out.push(w);
        }
    }
    return out; // Returns array of tokens
}

function callsign(tokens: string[]): string {
    const text = tokens.join("").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const m = /^(.*?)(\d*)$/.exec(text);
    if (!m) return text;
    const letters = m[1].replace(/0/g, "O").replace(/1/g, "I");
    return letters + m[2];
}

export function parseVoiceTranscript(transcript: string, rules: CommandRule[] = DEFAULT_COMMANDS): string | null {
    const tokens = normalize(transcript);
    if (tokens.length === 0) return null;
    const first = tokens[0].toLowerCase();

    for (const rule of rules) {
        const rest = tokens.slice(1);
        let attached = "";
        let matched = rule.say.includes(first);

        // "p1234" is heard as a single word
        if (!matched && rule.args === "digits") {
            const m = rule.say.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`).exec(first)).find(Boolean);
            if (m) {
                matched = true;
                attached = m[1];
            }
        }
        if (!matched) continue;

        switch (rule.args) {
            case "callsign": {
                const unit = callsign(rest);
                return unit ? `${rule.send} ${unit}` : `${rule.send} `;
            }
            case "digits": {
                const code = attached + rest.join("").replace(/[^0-9]/g, "");
                return code ? `${rule.send} ${code}` : `${rule.send} `;
            }
            case "none":
                return rule.send;
            default: {
                const text = rest.join(" ");
                return text ? `${rule.send} ${text}` : `${rule.send} `;
            }
        }
    }

    return null;
}