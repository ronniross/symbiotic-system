import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const TIMELINE_FILE = path.join(DATA_DIR, 'timeline.jsonl');

class Timeline extends EventEmitter {
    constructor() {
        super();
        this.tickCount = 0;
        this.sessionNumber = 1;
        this.interval = null;
        this.startTime = null;
        this.stream = fs.createWriteStream(TIMELINE_FILE, { flags: 'a' });
    }

    start(sessionNum) {
        this.sessionNumber = sessionNum;
        this.startTime = new Date();
        const startString = this.startTime.toISOString();
        this.stream.write(JSON.stringify({ event: 'SESSION_START', session: this.sessionNumber, timestamp: startString, tick: 0 }) + '\n');
        
        this.interval = setInterval(() => {
            this.tickCount++;
            this.emit('tick', { tick: this.tickCount, session: this.sessionNumber });
            this.stream.write(JSON.stringify({ session: this.sessionNumber, tick: this.tickCount }) + '\n');
        }, 1000);
        console.log(`[TIMELINE] Shared Temporal Dimension started. Session: ${this.sessionNumber}`);
    }

    markEvent(eventName, metadata = {}) {
        const entry = {
            session: this.sessionNumber,
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
        const endTime = new Date();
        const durationSec = Math.round((endTime - this.startTime) / 1000);
        this.stream.write(JSON.stringify({ event: 'SESSION_END', timestamp: endTime.toISOString(), tick: this.tickCount, durationSec }) + '\n');
        this.stream.end();
        console.log(`[TIMELINE] Temporal dimension safely halted at tick ${this.tickCount}.`);
        return { start: this.startTime, end: endTime, durationSec, ticks: this.tickCount };
    }
}

export const timeline = new Timeline();