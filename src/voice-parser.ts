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
    const alphabet = rules.some((r) => r.args === "callsign") ? " Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu." : "";
    return `Radio call. ${examples.join(" ")}${alphabet}`;
}

// Common spellings/mis-hearings the recogniser produces for NATO words
const NATO_ALIASES: Record<string, string> = {
    wiski: "W", wisky: "W", whisky: "W", wiskey: "W", whiskey: "W", pappa: "P", papper: "P", alfa: "A", juliet: "J", xray: "X", exray: "X", "x-ray": "X",
    novi: "N", nova: "N", novemer: "N", oskar: "O", sera: "S", siera: "S", sierre: "S", victer: "V", yanky: "Y", zoolu: "Z"
};

// Filler words the recogniser inserts between letters
const FILLERS = new Set(["in", "and", "the", "uh", "um", "a"]);

function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[b.length];
}

/** Maps a possibly mangled NATO word to its letter, or null if it doesn't look like one. */
function resolveNato(word: string): string | null {
    if (word in NATO) return NATO[word];
    if (word in NATO_ALIASES) return NATO_ALIASES[word];
    if (word.length < 4) return null;

    const collapsed = word.replace(/(.)\1+/g, "$1");
    const names = Object.keys(NATO);
    for (const n of names) {
        if (n.replace(/(.)\1+/g, "$1") === collapsed) return NATO[n];
    }

    // Closest NATO word within a small edit distance; ties are rejected
    const limit = word.length >= 6 ? 2 : 1;
    let best: string[] = [];
    let bestDist = limit + 1;
    for (const n of names) {
        const d = distance(word, n);
        if (d < bestDist) {
            bestDist = d;
            best = [n];
        } else if (d === bestDist) {
            best.push(n);
        }
    }
    if (best.length === 1) return NATO[best[0]];

    // Extra sounds stuck on a NATO word, e.g. "botango" for "tango"
    const tails = names.filter((n) => n.length >= 5 && word.length > n.length && word.endsWith(n));
    if (tails.length === 1) return NATO[tails[0]];

    // A unique three-letter start, e.g. "novi..." for "november"
    const starts = names.filter((n) => n.startsWith(word.slice(0, 3)));
    if (word.length >= 4 && starts.length === 1) return NATO[starts[0]];
    return null;
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
        } else if (i === 0 && !(w in NATO)) {
            // The first word is the command word, so it is never guessed as a letter
            out.push(w);
        } else if (resolveNato(w)) {
            out.push(resolveNato(w) as string);
        } else if (i > 0 && FILLERS.has(w)) {
            continue;
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