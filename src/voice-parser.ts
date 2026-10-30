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

export type ArgType = "callsign" | "digits" | "text" | "none" | "vehicle" | "plate";

/**
 * A spoken command. `say` lists the words that trigger it (include likely mis-hearings; codes like "10-3" and
 * "ten three" are treated as the same), `send` is the console command that is sent, and `args` says how the rest
 * of the speech is read. Each type only converts what it needs, so words are never changed by accident:
 * - "callsign": letters then digits, e.g. "kilo eight" -> K8
 * - "plate": a registration of letters and digits, e.g. "alpha bravo five charlie one" -> AB5C1
 * - "vehicle": a description, then "plate" and the registration, e.g. "red sedan plate kilo eight" -> red sedan K8
 * - "digits": digits only, e.g. "one two three" -> 123
 * - "text": the words exactly as spoken
 * - "none": no arguments
 *
 * `options` maps a spoken keyword straight to what is sent after `send` (checked before `args`).
 * `required` rejects the command when the argument (the plate for "vehicle") is missing; otherwise it is optional.
 * `minLength` / `maxLength` limit the length of the argument. `cooldown` is the seconds an identical command is ignored.
 */
export type CommandRule = {
    say: string[];
    send: string;
    args?: ArgType;
    options?: Record<string, string>;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    cooldown?: number;
};

/** Extra words the user can teach the parser. `corrections` rewrite phrases in the transcript; `vocabulary` maps a word to a letter or digits. */
export type ParserOptions = { corrections?: Record<string, string>; vocabulary?: Record<string, string> };

/** The outcome of reading a transcript, including a step-by-step account for debug mode. */
export type ParseResult = { command: string | null; rule: CommandRule | null; trace: string[] };

export const DEFAULT_COMMANDS: CommandRule[] = [
    { say: ["sam", "sum", "sem", "same", "sand", "sans", "psalm", "salm", "san"], send: "sam", args: "callsign" },
    { say: ["p", "pea", "pee", "postal", "go to"], send: "p", args: "digits" },
    { say: ["check plate", "check plates", "qvr", "plate"], send: "qvr", args: "plate", required: true },
    { say: ["10-3", "ten three"], send: "10-3", args: "callsign" },
    { say: ["10-2", "ten two"], send: "10-2", args: "none", options: { latest: "latest"} },
    { say: ["10-7", "ten seven"], send: "10-7", args: "digits"},
    { say: ["3t", "three t", "tt"], send: "3t", args: "vehicle" }
];

export const DEFAULT_COMMANDS_JSON = JSON.stringify(DEFAULT_COMMANDS, null, 2);

const ARG_TYPES = new Set<string>(["callsign", "digits", "text", "none", "vehicle", "plate"]);
const MAX_PLATE = 8;

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Parses the user's command list. Empty input means the defaults. Throws a readable error if invalid. */
export function parseCommandConfig(json: string | undefined): CommandRule[] {
    if (!json || !json.trim()) return DEFAULT_COMMANDS;
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data) || data.length === 0) throw new Error("Commands must be a non-empty list");
    return data.map((item, i) => {
        const r = item as Partial<CommandRule> | null;
        const n = i + 1;
        if (!r || !Array.isArray(r.say) || r.say.length === 0 || !r.say.every((s) => typeof s === "string" && s.trim())) {
            throw new Error(`Command ${n}: "say" must be a list of words`);
        }
        if (typeof r.send !== "string" || !r.send.trim() || /[\r\n;]/.test(r.send)) {
            throw new Error(`Command ${n}: "send" must be a single command`);
        }
        if (r.args !== undefined && !ARG_TYPES.has(r.args)) {
            throw new Error(`Command ${n}: "args" must be callsign, plate, vehicle, digits, text or none`);
        }
        if (r.options !== undefined && (typeof r.options !== "object" || r.options === null || Array.isArray(r.options) ||
            !Object.entries(r.options).every(([k, v]) => k.trim() && typeof v === "string" && !/[\r\n;]/.test(v)))) {
            throw new Error(`Command ${n}: "options" must map spoken words to text`);
        }
        if (r.required !== undefined && typeof r.required !== "boolean") throw new Error(`Command ${n}: "required" must be true or false`);
        if (r.minLength !== undefined && !isCount(r.minLength)) throw new Error(`Command ${n}: "minLength" must be a whole number`);
        if (r.maxLength !== undefined && !isCount(r.maxLength)) throw new Error(`Command ${n}: "maxLength" must be a whole number`);
        if (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength) {
            throw new Error(`Command ${n}: "minLength" is larger than "maxLength"`);
        }
        if (r.cooldown !== undefined && !(typeof r.cooldown === "number" && r.cooldown >= 0)) {
            throw new Error(`Command ${n}: "cooldown" must be a number of seconds`);
        }

        const rule: CommandRule = { say: r.say.map((s) => s.trim().toLowerCase()), send: r.send.trim(), args: r.args ?? "text" };
        if (r.options) rule.options = Object.fromEntries(Object.entries(r.options).map(([k, v]) => [k.trim().toLowerCase(), v.trim()]));
        if (r.required !== undefined) rule.required = r.required;
        if (r.minLength !== undefined) rule.minLength = r.minLength;
        if (r.maxLength !== undefined) rule.maxLength = r.maxLength;
        if (r.cooldown !== undefined) rule.cooldown = r.cooldown;
        return rule;
    });
}

/** Parses a JSON object of word -> text (used for corrections and vocabulary). Empty input means none. */
export function parseWordMap(json: string | undefined, label: string): Record<string, string> {
    if (!json || !json.trim()) return {};
    const data: unknown = JSON.parse(json);
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${label} must be a JSON object`);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
        const key = k.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        if (!key || typeof v !== "string") throw new Error(`${label}: "${k}" must map to text`);
        out[key] = v;
    }
    return out;
}

/** A short example phrase list that biases the speech recogniser towards the configured commands. */
export function buildPrompt(rules: CommandRule[], options: ParserOptions = {}): string {
    const examples = rules.map((r) => {
        const word = r.say[0];
        if (r.args === "callsign") return `${word} K 8. ${word} W N T 1 1.`;
        if (r.args === "plate") return `${word} A B 5 C 1.`;
        if (r.args === "vehicle") return `${word} red sedan plate A B 5 C 1.`;
        if (r.args === "digits") return `${word} 1 2 3 4.`;
        return `${word}.`;
    });
    const spelled = rules.some((r) => r.args === "callsign" || r.args === "plate" || r.args === "vehicle");
    const alphabet = spelled ? " Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu." : "";
    const extra = Object.keys(options.vocabulary ?? {}).join(" ");
    return `Radio call. ${examples.join(" ")}${alphabet}${extra ? ` ${extra}.` : ""}`;
}

// Common spellings/mis-hearings the recogniser produces for NATO words
const NATO_ALIASES: Record<string, string> = {
    wiski: "W", wisky: "W", whisky: "W", wiskey: "W", whiskey: "W", pappa: "P", papper: "P", alfa: "A", juliet: "J", xray: "X", exray: "X", "x-ray": "X",
    novi: "N", nova: "N", novemer: "N", oskar: "O", sera: "S", siera: "S", sierre: "S", victer: "V", yanky: "Y", zoolu: "Z"
};

// Filler words the recogniser inserts between spelled letters
const FILLERS = new Set(["in", "and", "the", "uh", "um"]);

// Words that introduce the registration in a vehicle description
const PLATE_MARKERS = new Set(["plate", "plates", "registration", "rego", "reg"]);

const COLOURS = new Set(["red", "blue", "white", "black", "silver", "grey", "gray", "green", "yellow", "orange", "purple", "brown", "gold", "pink", "tan", "beige", "maroon"]);

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

type Word = { raw: string; low: string };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Stage 1 - basic: strip punctuation, collapse whitespace, apply the user's corrections. Words keep their spelling and case.
function basicWords(transcript: string, corrections: Record<string, string>): Word[] {
    let text = transcript.replace(/[^A-Za-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    for (const [heard, meant] of Object.entries(corrections)) {
        text = text.replace(new RegExp(`\\b${escapeRegExp(heard).replace(/ /g, "\\s+")}\\b`, "gi"), () => meant);
    }
    return text.split(/\s+/).filter(Boolean).map((w) => ({ raw: w, low: w.toLowerCase() }));
}

// Stage 2 - numbers: spoken numbers become digits. Only used where a command expects numbers.
function numberWords(words: string[], vocabulary: Record<string, string>): string[] {
    const out: string[] = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w in vocabulary) {
            out.push(vocabulary[w].toLowerCase());
        } else if (w in TENS) {
            const next = UNITS[words[i + 1]];
            if (next && next.length === 1 && next !== "0") {
                out.push(String(TENS[w] + Number(next)));
                i++;
            } else {
                out.push(String(TENS[w]));
            }
        } else if (w in UNITS) {
            out.push(UNITS[w]);
        } else {
            out.push(w);
        }
    }
    return out;
}

// Stage 3 - NATO: spoken letters and digits become one string of characters. Only used for callsigns and plates.
function spellOut(words: string[], vocabulary: Record<string, string>): { value: string; bad: string[] } {
    let value = "";
    const bad: string[] = [];
    for (const w of numberWords(words, vocabulary)) {
        if (FILLERS.has(w)) continue;
        if (/^\d+$/.test(w)) {
            value += w;
            continue;
        }
        const letter = resolveNato(w);
        if (letter) value += letter;
        else if (/^[a-z0-9]+$/.test(w) && (w.length <= 3 || /\d/.test(w))) value += w.toUpperCase();
        else bad.push(w);
    }
    return { value, bad };
}

// Misheard "I"/"O" in the letter part of a callsign often arrive as digits
function callsignText(value: string): string {
    const m = /^(.*?)(\d*)$/.exec(value);
    if (!m) return value;
    return m[1].replace(/0/g, "O").replace(/1/g, "I") + m[2];
}

type Arg = { value: string; error?: string };

function checkLength(rule: CommandRule, value: string, fallbackMax?: number): string | undefined {
    if (!value) return undefined;
    const max = rule.maxLength ?? fallbackMax;
    if (rule.minLength !== undefined && value.length < rule.minLength) return `too short (${value.length} < ${rule.minLength})`;
    if (max !== undefined && value.length > max) return `too long (${value.length} > ${max})`;
    return undefined;
}

function readPlate(words: Word[], rule: CommandRule, vocabulary: Record<string, string>, trace: string[]): Arg {
    const { value, bad } = spellOut(words.map((w) => w.low), vocabulary);
    trace.push(`plate: ${words.map((w) => w.low).join(" ") || "(nothing)"} -> ${value || "(empty)"}${bad.length ? ` unreadable: ${bad.join(", ")}` : ""}`);
    if (bad.length) return { value: "", error: `could not read "${bad.join(" ")}" as a plate` };
    if (value && !/^[A-Z0-9]+$/.test(value)) return { value: "", error: "plate has invalid characters" };
    const length = checkLength(rule, value, MAX_PLATE);
    return length ? { value: "", error: `plate ${length}` } : { value };
}

function readArg(rule: CommandRule, words: Word[], attached: string, vocabulary: Record<string, string>, trace: string[]): Arg {
    switch (rule.args) {
        case "none":
            return { value: "" };
        case "digits": {
            const value = attached + numberWords(words.map((w) => w.low), vocabulary).join("").replace(/[^0-9]/g, "");
            trace.push(`digits: ${words.map((w) => w.low).join(" ") || "(nothing)"} -> ${value || "(empty)"}`);
            const length = checkLength(rule, value);
            return length ? { value: "", error: `digits ${length}` } : { value };
        }
        case "callsign": {
            const { value: spelled, bad } = spellOut(words.map((w) => w.low), vocabulary);
            const value = callsignText(spelled);
            trace.push(`callsign: ${words.map((w) => w.low).join(" ") || "(nothing)"} -> ${value || "(empty)"}${bad.length ? ` unreadable: ${bad.join(", ")}` : ""}`);
            if (bad.length) return { value: "", error: `could not read "${bad.join(" ")}" as a callsign` };
            if (value && !/^[A-Z]+\d*$/.test(value)) return { value: "", error: `"${value}" is not letters followed by digits` };
            const length = checkLength(rule, value, MAX_PLATE);
            return length ? { value: "", error: `callsign ${length}` } : { value };
        }
        case "plate":
            return readPlate(words, rule, vocabulary, trace);
        case "vehicle": {
            const at = words.findIndex((w) => PLATE_MARKERS.has(w.low));
            const describing = (at < 0 ? words : words.slice(0, at)).map((w) => w.raw);
            // Whisper capitalises the first word of a sentence, so a leading colour is put back to lower case
            if (describing.length && COLOURS.has(describing[0].toLowerCase()) && /^[A-Z][a-z]+$/.test(describing[0])) {
                describing[0] = describing[0].toLowerCase();
            }
            const description = describing.join(" ");
            trace.push(`vehicle description: ${description || "(none)"}${at < 0 ? " (no plate word heard)" : ""}`);
            const plate = at < 0 ? { value: "" } : readPlate(words.slice(at + 1), rule, vocabulary, trace);
            if (plate.error) return plate;
            if (rule.required && !plate.value) return { value: "", error: "plate required" };
            return { value: [description, plate.value].filter(Boolean).join(" ") };
        }
        default: {
            const value = words.map((w) => w.raw).join(" ");
            trace.push(`text: ${value || "(nothing)"}`);
            const length = checkLength(rule, value);
            return length ? { value: "", error: `text ${length}` } : { value };
        }
    }
}

/** Reads a transcript and says what would be sent, with a trace of how each word was interpreted. */
export function interpretTranscript(transcript: string, rules: CommandRule[] = DEFAULT_COMMANDS, options: ParserOptions = {}): ParseResult {
    const trace: string[] = [`heard: "${transcript}"`];
    const vocabulary = options.vocabulary ? Object.fromEntries(Object.entries(options.vocabulary).map(([k, v]) => [k.toLowerCase(), v])) : {};
    const words = basicWords(transcript, options.corrections ?? {});
    trace.push(`words: ${words.map((w) => w.low).join(" ") || "(none)"}`);
    if (words.length === 0) return { command: null, rule: null, trace };

    // Find the command, preferring the longest spoken match, e.g. "ten three" and "10-3" both give "103"
    let best: { rule: CommandRule; used: number; attached: string } | null = null;
    for (const rule of rules) {
        for (const phrase of rule.say) {
            const target = numberWords(phrase.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean), vocabulary).join("");
            if (!target) continue;
            for (let used = 1; used <= Math.min(words.length, 5); used++) {
                if (best && used <= best.used) continue;
                if (numberWords(words.slice(0, used).map((w) => w.low), vocabulary).join("") === target) best = { rule, used, attached: "" };
            }
            // "p1234" is heard as a single word
            if (rule.args === "digits" && !best) {
                const m = new RegExp(`^${escapeRegExp(target)}(\\d+)$`).exec(words[0].low);
                if (m) best = { rule, used: 1, attached: m[1] };
            }
        }
    }
    if (!best) {
        trace.push("no command matched");
        return { command: null, rule: null, trace };
    }

    const { rule, used, attached } = best;
    const rest = words.slice(used);
    trace.push(`command: ${words.slice(0, used).map((w) => w.low).join(" ")} -> "${rule.send}" (${rule.args})`);

    if (rule.options) {
        const spoken = rest.map((w) => w.low).join(" ");
        const key = Object.keys(rule.options).find((k) => spoken === k || spoken.startsWith(`${k} `) || spoken === k.replace(/\s+/g, ""));
        if (key) {
            trace.push(`option: ${key} -> ${rule.options[key]}`);
            return { command: `${rule.send} ${rule.options[key]}`.trimEnd(), rule, trace };
        }
    }

    const arg = readArg(rule, rest, attached, vocabulary, trace);
    if (arg.error) {
        trace.push(`rejected: ${arg.error}`);
        return { command: null, rule, trace };
    }
    if (!arg.value && rule.required && rule.args !== "none") {
        trace.push("rejected: argument required");
        return { command: null, rule, trace };
    }
    if (rule.args === "none") return { command: rule.send, rule, trace };
    return { command: arg.value ? `${rule.send} ${arg.value}` : `${rule.send} `, rule, trace };
}

export function parseVoiceTranscript(transcript: string, rules: CommandRule[] = DEFAULT_COMMANDS, options: ParserOptions = {}): string | null {
    return interpretTranscript(transcript, rules, options).command;
}
