import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { initModel, generateChat, clearHistory, contractState, generateFileHash } from './src/llm.js';
import { timeline } from './src/timeline.js';
import { initMemory, saveRawEvent, getMemoryStats, processDreaming, retrieveSubconscious } from './src/memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOG_FILE = path.join(__dirname, 'chat_log.txt');
let memoryEngineActive = false; // Boot toggle state

function askSystemQuestion(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

// --- NEW: TIMELINE STREAMING ROUTE ---
app.get('/api/timeline/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onTick = (tick) => { res.write(`data: ${JSON.stringify({ tick })}\n\n`); };
    timeline.on('tick', onTick);

    req.on('close', () => { timeline.off('tick', onTick); });
});

app.post('/api/chat', async (req, res) => {
    const originalPrompt = req.body.prompt;
    const useMemory = req.body.useMemory;
    const timestampUser = new Date().toISOString();
    const promptHash = crypto.createHash('sha256').update(originalPrompt, 'utf8').digest('hex');

    console.log(`\n[DEBUG - Server] Received prompt Hash: ${promptHash}`);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        let finalPrompt = originalPrompt;
        let memoryRecallText = null;

        // --- NEW: Subconscious Retrieval Logic ---
        if (memoryEngineActive && useMemory) {
            const memoryData = await retrieveSubconscious(originalPrompt);
            if (memoryData) {
                memoryRecallText = memoryData.uiString;
                // Augment the prompt hidden from UI but visible to LLM Context
                finalPrompt = `${memoryData.llmContext}\n\n[HUMAN PROMPT]\n${originalPrompt}`;
                
                // Immediately send recall info to UI before generation
                res.write(`data: ${JSON.stringify({ recall: memoryRecallText })}\n\n`);
                console.log(`[DEBUG - Server] Memory Injected! ${memoryRecallText.replace(/\n/g, ' ')}`);
            }
        }

        const aiText = await generateChat(finalPrompt, (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        });

        const timestampAI = new Date().toISOString();
        const responseHash = crypto.createHash('sha256').update(aiText, 'utf8').digest('hex');

        let currentContractHash = "UNKNOWN_OR_MISSING";
        let isValid = false;
        if (contractState.path && fs.existsSync(contractState.path)) {
            currentContractHash = await generateFileHash(contractState.path);
            isValid = (currentContractHash === contractState.hash);
        }

        const metadata = { promptHash, responseHash, contractHash: currentContractHash, isValid };
        res.write(`data: ${JSON.stringify({ metadata })}\n\n`);

        // Log to Chatlog
        const memoryLogStr = memoryRecallText ? `\n[SUBCONSCIOUS INJECTION]\n${memoryRecallText}` : '';
        const userLogEntry = `[${timestampUser}] Human Symbiont [Hash: ${promptHash}]:${memoryLogStr}\n${originalPrompt}\n\n`;
        fs.appendFileSync(LOG_FILE, userLogEntry, 'utf8');

        const verificationString = isValid ? "VERIFIED VALID" : "INVALIDATED/TAMPERED";
        const aiLogEntry = `[${timestampAI}] Qwen3-VL Digital Symbiont [Hash: ${responseHash}]:\n[Contract Integrity: ${verificationString} | File Hash: ${currentContractHash}]\n${aiText}\n\n`;
        fs.appendFileSync(LOG_FILE, aiLogEntry, 'utf8');
        fs.appendFileSync(LOG_FILE, "==================================================\n\n", 'utf8');

        const eventTick = timeline.markEvent('INFERENCE_COMPLETED', { promptHash, responseHash });
        saveRawEvent(originalPrompt, aiText, promptHash, responseHash, eventTick);

        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        console.error('[DEBUG - Server] Error generating text:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

app.get('/api/memory/stats', (req, res) => {
    try { res.json(getMemoryStats()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dream', async (req, res) => {
    if (!memoryEngineActive) return res.json({ error: "Memory engine disabled."});
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        await processDreaming((message, progress) => { res.write(`data: ${JSON.stringify({ message, progress })}\n\n`); });
        res.write(`data: [DONE]\n\n`); res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`); res.end();
    }
});

app.post('/api/clearcache', (req, res) => {
    clearHistory();
    if (global.gc) { global.gc(); res.json({ message: "VRAM Context cleared & Memory Garbage Collected." }); } 
    else { res.json({ message: "VRAM Context cleared, but Node GC was unavailable." }); }
});

app.post('/api/shutdown', (req, res) => {
    res.json({ message: "Server shutting down." });
    timeline.stop();
    setTimeout(() => process.exit(0), 1000); 
});

const PORT = 3000;
console.log('========================================');
console.log('  BOOTING SYMBIOTIC NODE SERVER...');
console.log('========================================');

async function bootSystem() {
    try {
        // --- NEW: Boot configuration prompt ---
        const memAns = await askSystemQuestion("Initialize Subconscious Memory & Dream Engine? (Y/n): ");
        if (memAns.trim().toLowerCase() !== 'n') {
            memoryEngineActive = await initMemory();
        } else {
            console.log("[BOOT] Subconscious Memory System bypassed.");
            memoryEngineActive = false;
        }

        await initModel(); 
        timeline.start();

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