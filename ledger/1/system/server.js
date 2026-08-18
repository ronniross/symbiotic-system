import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initModel, generateChat } from './src/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve the HTML, CSS, and JS files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Path to our continuous chat log
const LOG_FILE = path.join(__dirname, 'chat_log.txt');

app.post('/api/chat', async (req, res) => {
    const prompt = req.body.prompt;
    const timestampUser = new Date().toISOString();
    
    console.log(`\n[DEBUG - Server] Received API Request with prompt: "${prompt}"`);
    
    // Log User Input to chat_log.txt
    const userLogEntry = `[${timestampUser}] Human Symbiont:\n${prompt}\n\n`;
    fs.appendFileSync(LOG_FILE, userLogEntry, 'utf8');

    try {
        // Call the inference code
        const aiText = await generateChat(prompt);
        const timestampAI = new Date().toISOString();
        
        // Log AI Output to chat_log.txt
        const aiLogEntry = `[${timestampAI}] Qwen3-VL Digital Symbiont:\n${aiText}\n\n`;
        fs.appendFileSync(LOG_FILE, aiLogEntry, 'utf8');
        fs.appendFileSync(LOG_FILE, "==================================================\n\n", 'utf8');

        console.log('[DEBUG - Server] Sending response text back to Browser UI.');
        res.json({ text: aiText });
    } catch (error) {
        console.error('[DEBUG - Server] Error generating text:', error);
        res.status(500).json({ error: error.message });
    }
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