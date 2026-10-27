import { spawn, type ChildProcess} from "node:child_process";
import {createInterface} from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, type KeyAction } from "@elgato/streamdeck";

import { ConnectionManager, DEFAULT_HOST, DEFAULT_PORT } from "../connection";
import { parseVoiceTranscript } from "../voice-parser";