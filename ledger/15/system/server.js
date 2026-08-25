import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';

import { initModel, generateChat, clearHistory, contractState } from './src/llm.js';
import { timeline } from './src/timeline.js';
import { initMemory, saveRawEvent, getMemoryStats, processDreaming, retrieveSubconscious, archiveSessionToCheckpoint, getMemoryMap } from './src/memory.js';
import { generateSystemManifest, generateFileHash } from './src/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOG_FILE = path.join(__dirname, 'chat_log.txt');

// --- ROOT FOLDER CONFIGURATION ---
// FIXED: We now dynamically set the root to the CURRENT directory where the server is running.
// This prevents duplicated/versioned folders (like moving from 13 to 15) from getting stuck 
// reading the old path from the text file.
const ROOT_CONFIG_PATH = path.join(__dirname, 'root_folder.txt');
const systemRootFolder = __dirname;
fs.writeFileSync(ROOT_CONFIG_PATH, systemRootFolder, 'utf8');

// Global Boot State Variables
let memoryConfig = { active: false };
let bootManifest = null;
let startMode = 'f';
let bootStatsString = "";

function askSystemQuestion(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

// API Routes
app.get('/api/boot-info', (req, res) => {
    res.json({
        userName: contractState.userName,
        sessionNumber: memoryConfig.sessionNum || 1,
        syncString: memoryConfig.syncString || "",
        manifest: bootManifest
    });
});

app.get('/api/timeline/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const onTick = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
    timeline.on('tick', onTick);
    req.on('close', () => { timeline.off('tick', onTick); });
});

// Endpoint to get full map for the animation engine
app.get('/api/memory/map', (req, res) => {
    res.json(getMemoryMap());
});

app.post('/api/chat', async (req, res) => {
    const originalPrompt = req.body.prompt;
    const useMemory = req.body.useMemory;
    const timestampUser = new Date().toISOString();
    const promptHash = crypto.createHash('sha256').update(originalPrompt, 'utf8').digest('hex');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        let finalPrompt = originalPrompt;
        let memoryRecallText = null;
        let memoryRecalledIds = [];

        if (memoryConfig.active && useMemory) {
            console.log(`\n[MEMORY] Subconscious search requested...`);
            const memoryData = await retrieveSubconscious(originalPrompt);
            if (memoryData) {
                console.log(`[MEMORY] Match found! Injecting recall context.`);
                memoryRecallText = memoryData.uiString;
                memoryRecalledIds = memoryData.recalledIds;
                finalPrompt = `${memoryData.llmContext}\n\n[HUMAN PROMPT]\n${originalPrompt}`;
                res.write(`data: ${JSON.stringify({ recall: memoryRecallText, recalledIds: memoryRecalledIds })}\n\n`);
            } else {
                console.log(`[MEMORY] No significant matches found in RAM.`);
            }
        }

        const aiText = await generateChat(finalPrompt, (chunk) => { res.write(`data: ${JSON.stringify({ chunk })}\n\n`); });
        const timestampAI = new Date().toISOString();
        const responseHash = crypto.createHash('sha256').update(aiText, 'utf8').digest('hex');

        let currentContractHash = "UNKNOWN";
        let isValid = false;
        if (contractState.path && fs.existsSync(contractState.path)) {
            currentContractHash = await generateFileHash(contractState.path);
            isValid = (currentContractHash === contractState.hash);
        }

        const eventTick = timeline.markEvent('INFERENCE_COMPLETED', { promptHash, responseHash });
        
        let eventId = null;
        if (memoryConfig.active) {
            eventId = saveRawEvent(originalPrompt, aiText, promptHash, responseHash, eventTick);
        }

        res.write(`data: ${JSON.stringify({ metadata: { promptHash, responseHash, contractHash: currentContractHash, isValid, eventId } })}\n\n`);

        const memoryLogStr = memoryRecallText ? `\n[SUBCONSCIOUS INJECTION]\n${memoryRecallText}` : '';
        fs.appendFileSync(LOG_FILE, `[${timestampUser}] Human Symbiont [Hash: ${promptHash}]:${memoryLogStr}\n${originalPrompt}\n\n`, 'utf8');
        fs.appendFileSync(LOG_FILE, `[${timestampAI}] Qwen3-VL Digital Symbiont [Hash: ${responseHash}]:\n[Contract Integrity: ${isValid?"VALID":"TAMPERED"} | Hash: ${currentContractHash}]\n${aiText}\n\n==================================================\n\n`, 'utf8');

        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) { res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`); res.end(); }
});

app.get('/api/memory/stats', (req, res) => { res.json(getMemoryStats()); });
app.post('/api/dream', async (req, res) => {
    if (!memoryConfig.active) return res.json({ error: "Memory engine disabled."});
    res.setHeader('Content-Type', 'text/event-stream');
    try { await processDreaming((message, progress) => { res.write(`data: ${JSON.stringify({ message, progress })}\n\n`); }); res.write(`data: [DONE]\n\n`); res.end(); } 
    catch (err) { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
});

app.post('/api/clearcache', (req, res) => {
    clearHistory();
    if (global.gc) { global.gc(); res.json({ message: "VRAM Context cleared & Garbage Collected." }); } 
    else { res.json({ message: "VRAM cleared, but Node GC unavailable." }); }
});

app.post('/api/shutdown', async (req, res) => {
    console.log('\n[CRITICAL] Initiating Closing Step. Calculating Final Manifests...');
    res.json({ message: "Closing step initiated. Unloading." });
    
    const timeStats = timeline.stop();
    const endManifest = await generateSystemManifest(systemRootFolder);

    const closingLog = `\n==================================================
CLOSING STEP SUMMARY
==================================================
Session ID: ${memoryConfig.sessionNum || 1}
Start Time: ${timeStats.start.toISOString()}
End Time:   ${timeStats.end.toISOString()}
Duration:   ${timeStats.durationSec} Seconds
Total Ticks/Intervals: ${timeStats.ticks}

--- FINAL PROJECT FILE MANIFEST ---
Target Root: ${systemRootFolder}
Total Files Tracked: ${endManifest.totalFiles}
Total Size Tracked:  ${endManifest.totalSizeStr}

[FILE HASHES]
${endManifest.files.map(f => `${f.timestamp} | ${f.sizeStr.padEnd(10)} | ${f.hash} | ${f.file}`).join('\n')}
==================================================\n`;

    fs.appendFileSync(LOG_FILE, closingLog, 'utf8');

    console.log('[SHUTDOWN] Archiving Session and Moving Chat Log...');
    let archiveDirStr = "None";
    
    const archivedPath = archiveSessionToCheckpoint(memoryConfig.sessionNum || 1, startMode, LOG_FILE);
    if (archivedPath) archiveDirStr = path.relative(__dirname, archivedPath);

    console.log(`[SHUTDOWN] Artifacts archived to: ${archiveDirStr}`);
    console.log('[SHUTDOWN] Closing Step Complete. Goodbye.');
    setTimeout(() => process.exit(0), 500); 
});

const PORT = 3000;
console.log('========================================');
console.log('  BOOTING SYMBIOTIC NODE SERVER...');
console.log('========================================');

async function bootSystem() {
    try {
        console.log(`[BOOT] Hashing Root Folder set to: ${systemRootFolder}`);
        
        const memAns = await askSystemQuestion("Initialize Subconscious Memory & Dream Engine? (Y/n): ");
        if (memAns.trim().toLowerCase() !== 'n') {
            const startAns = await askSystemQuestion("Start new fresh memory DB or continue from checkpoint? (F/c): ");
            startMode = startAns.trim().toLowerCase();
            memoryConfig = await initMemory(startMode);

            if (memoryConfig.stats) {
                bootStatsString = `Located: ${memoryConfig.stats.models} Models, ${memoryConfig.stats.sessions} Sessions, ${memoryConfig.stats.inferences} Inferences, ${memoryConfig.stats.graphs} Graphs.`;
                console.log(`[BOOT] ${bootStatsString}`);
            }
        } else {
            memoryConfig = { active: false, sessionNum: 1 };
        }

        console.log("\n[BOOT] Generating System Pre-flight Manifest... (This may take a moment to hash GGUF models)");
        bootManifest = await generateSystemManifest(systemRootFolder);
        
        fs.appendFileSync(LOG_FILE, `\n==================================================\nPRE-FLIGHT SYSTEM MANIFEST\nTarget Root: ${systemRootFolder}\n${bootManifest.timestamp}\nTotal Size: ${bootManifest.totalSizeStr} | Total Files: ${bootManifest.totalFiles}\n${bootManifest.files.map(f => `${f.sizeStr.padEnd(10)} | ${f.hash} | ${f.file}`).join('\n')}\n==================================================\n\n`, 'utf8');

        if (memoryConfig.active && memoryConfig.syncString) {
            fs.appendFileSync(LOG_FILE, `${memoryConfig.syncString}\n${bootStatsString}\n\n`, 'utf8');
        }

        await initModel(memoryConfig); 
        timeline.start(memoryConfig.sessionNum || 1);

        app.listen(PORT, () => {
            console.log(`\n========================================`);
            console.log(`[NETWORK] Symbiotic Link Active!`);
            console.log(`[NETWORK] Open browser: http://localhost:${PORT}`);
            console.log(`========================================\n`);
        });
    } catch (err) {
        console.error("[CRITICAL] Failed to boot:", err);
        process.exit(1);
    }
}
bootSystem();