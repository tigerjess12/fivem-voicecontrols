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

// Sets for recognizing SAM and P prefixes in speech
const SAM = new Set(["sam", "sum", "sem", "same", "sand", "sans", "psalm", "salm"]);
const P = new Set(["p", "pea", "pee"]);

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

export function parseVoiceTranscript(transcript: string): string | null {
    const tokens = normalize(transcript);
    if (tokens.length === 0) return null;

    if (SAM.has(tokens[0])) {
        const unit = callsign(tokens.slice(1));
        return unit ? `sam ${unit}` : "sam ";
    }

    const attached = /^p(\d+)$/.exec(tokens[0]);
    if (attached || P.has(tokens[0])) {
        const code = (attached ? attached[1] : "") + tokens.slice(1).join("").replace(/[^0-9]/g, "");
        return code ? `p ${code}` : 'p ';
    }
    
    return null;
}