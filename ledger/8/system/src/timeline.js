import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FIXED: Go up one level
const DATA_DIR = path.join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const TIMELINE_FILE = path.join(DATA_DIR, 'timeline.jsonl');

class Timeline {
    constructor() {
        this.tickCount = 0;
        this.interval = null;
        this.stream = fs.createWriteStream(TIMELINE_FILE, { flags: 'a' });
    }

    start() {
        const startString = new Date().toISOString();
        this.stream.write(JSON.stringify({ event: 'SESSION_START', timestamp: startString, tick: 0 }) + '\n');
        
        this.interval = setInterval(() => {
            this.tickCount++;
            this.stream.write(JSON.stringify({ tick: this.tickCount }) + '\n');
        }, 1000);
        console.log(`[TIMELINE] Shared Temporal Dimension started.`);
    }

    markEvent(eventName, metadata = {}) {
        const entry = {
            tick: this.tickCount,
            event: eventName,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        this.stream.write(JSON.stringify(entry) + '\n');
        return this.tickCount;
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        this.stream.write(JSON.stringify({ event: 'SESSION_END', timestamp: new Date().toISOString(), tick: this.tickCount }) + '\n');
        this.stream.end();
        console.log(`[TIMELINE] Temporal dimension safely halted at tick ${this.tickCount}.`);
    }
}

export const timeline = new Timeline();