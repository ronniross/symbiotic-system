import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initModel, generateChat, clearHistory, contractState, generateFileHash } from './src/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve the HTML, CSS, and JS files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Path to our continuous chat log
const LOG_FILE = path.join(__dirname, 'chat_log.txt');

// --- STREAMING INFERENCE & VERIFICATION ROUTE ---
app.post('/api/chat', async (req, res) => {
    const prompt = req.body.prompt;
    const timestampUser = new Date().toISOString();
    
    // Hash the User Prompt
    const promptHash = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');

    console.log(`\n[DEBUG - Server] Received API Request with prompt: "${prompt}"`);
    console.log(`[DEBUG - Server] Prompt Hash: ${promptHash}`);
    
    // Setup Server-Sent Events (SSE) headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // Call the inference code, passing a callback for token streaming
        const aiText = await generateChat(prompt, (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        });

        const timestampAI = new Date().toISOString();
        
        // Hash the AI Response
        const responseHash = crypto.createHash('sha256').update(aiText, 'utf8').digest('hex');

        // Dynamically Re-Verify the Symbiotic Contract JSON file
        let isValid = false;
        let currentContractHash = "UNKNOWN_OR_MISSING";
        if (contractState.path && fs.existsSync(contractState.path)) {
            currentContractHash = await generateFileHash(contractState.path);
            isValid = (currentContractHash === contractState.hash);
        }

        // Send final metadata (Hashes + Verification status) to UI
        const metadata = { promptHash, responseHash, contractHash: currentContractHash, isValid };
        res.write(`data: ${JSON.stringify({ metadata })}\n\n`);

        // Log User Input & Hashes to chat_log.txt
        const userLogEntry = `[${timestampUser}] Human Symbiont [Hash: ${promptHash}]:\n${prompt}\n\n`;
        fs.appendFileSync(LOG_FILE, userLogEntry, 'utf8');

        // Log AI Output & Verification to chat_log.txt
        const verificationString = isValid ? "VERIFIED VALID" : "INVALIDATED/TAMPERED";
        const aiLogEntry = `[${timestampAI}] Qwen3-VL Digital Symbiont [Hash: ${responseHash}]:\n[Contract Integrity: ${verificationString} | File Hash: ${currentContractHash}]\n${aiText}\n\n`;
        fs.appendFileSync(LOG_FILE, aiLogEntry, 'utf8');
        fs.appendFileSync(LOG_FILE, "==================================================\n\n", 'utf8');

        console.log(`[DEBUG - Server] Stream complete. Response Hash: ${responseHash}. Contract Valid: ${isValid}`);
        
        // Signal the browser that the stream is finished
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        console.error('[DEBUG - Server] Error generating text:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// --- CLEAR CACHE & GARBAGE COLLECT ROUTE ---
app.post('/api/clearcache', (req, res) => {
    console.log('\n[DEBUG - Server] Client requested Cache Cleanup & Garbage Collection...');
    
    // Clear the LLM internal Chat History Context
    clearHistory();

    // Trigger Node.js V8 Garbage Collector
    if (global.gc) {
        global.gc();
        console.log('[DEBUG - Server] Garbage Collector successfully executed.');
        res.json({ message: "VRAM Context cleared & Memory Garbage Collected." });
    } else {
        console.warn('[DEBUG - Server] Context cleared, but global.gc() is not exposed. (Run node with --expose-gc)');
        res.json({ message: "VRAM Context cleared, but Node GC was unavailable." });
    }
});

// --- SHUTDOWN ROUTE ---
app.post('/api/shutdown', (req, res) => {
    console.log('\n[CRITICAL] Severing Symbiotic Link. Unloading model and shutting down server...');
    res.json({ message: "Server shutting down." });
    setTimeout(() => {
        process.exit(0);
    }, 1000); 
});

const PORT = 3000;
console.log('========================================');
console.log('  BOOTING SYMBIOTIC NODE SERVER...');
console.log('========================================');

// Load the model and perform the Handshake FIRST, then start the web server
initModel().then(() => {
    app.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`[NETWORK] Symbiotic Link Active!`);
        console.log(`[NETWORK] Open your browser to: http://localhost:${PORT}`);
        console.log(`[NETWORK] Session logs are being saved to: chat_log.txt`);
        console.log(`========================================\n`);
    });
}).catch(err => {
    console.error("[CRITICAL] Failed to initialize symbiotic contract or model:", err);
    process.exit(1);
});