import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLlama } from 'node-llama-cpp';
import { MAIN_MODEL_NAME } from './llm.js';
import { generateFileHash } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const CHECKPOINTS_DIR = path.join(DATA_DIR, 'checkpoints');
const ACTIVE_DIR = path.join(DATA_DIR, 'active_session');
const ACTIVE_MEMORIES = path.join(ACTIVE_DIR, 'memories');
const ACTIVE_GRAPH = path.join(ACTIVE_DIR, 'memory_graph.json');

const EMBED_MODEL_NAME = 'all-MiniLM-L6-v2-ggml-model-f16.gguf';

let embedModel = null;
let embedContext = null;
let ramPool = [];
let activeSessionNumber = 1;

function prepareActiveDirectory() {
    if (fs.existsSync(ACTIVE_DIR)) fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
    fs.mkdirSync(ACTIVE_MEMORIES, { recursive: true });
    fs.writeFileSync(ACTIVE_GRAPH, JSON.stringify({ nodes: [], edges: [] }, null, 2));
}

export function scanCheckpointStats() {
    if (!fs.existsSync(CHECKPOINTS_DIR)) return { models: 0, sessions: 0, inferences: 0, graphs: 0, maxSession: 0 };
    
    let stats = { models: 0, sessions: 0, inferences: 0, graphs: 0, maxSession: 0 };
    const modelDirs = fs.readdirSync(CHECKPOINTS_DIR).filter(d => fs.statSync(path.join(CHECKPOINTS_DIR, d)).isDirectory());
    stats.models = modelDirs.length;

    // Scan ALL models to allow cross-modal memory retrieval
    for (const mDir of modelDirs) {
        const modelDirPath = path.join(CHECKPOINTS_DIR, mDir);
        const sessionDirs = fs.readdirSync(modelDirPath).filter(d => d.startsWith('session_'));
        stats.sessions += sessionDirs.length;
        
        for (const sDir of sessionDirs) {
            const sNum = parseInt(sDir.split('_')[1]);
            if (sNum > stats.maxSession) stats.maxSession = sNum;

            const memPath = path.join(modelDirPath, sDir, 'memories');
            if (fs.existsSync(memPath)) {
                stats.inferences += fs.readdirSync(memPath).filter(f => f.endsWith('.json')).length;
            }
            if (fs.existsSync(path.join(modelDirPath, sDir, 'memory_graph.json'))) {
                stats.graphs++;
            }
        }
    }
    return stats;
}

export async function initMemory(startMode) {
    console.log('\n--- INITIALIZING DREAM ENGINE & SUBCONSCIOUS ---');
    const MODEL_PATH = path.join(__dirname, '../models', EMBED_MODEL_NAME);
    
    if (!fs.existsSync(MODEL_PATH)) return { active: false };

    const checkpointStats = scanCheckpointStats();
    activeSessionNumber = 1;
    let syncString = "[MEMORY] Started fresh memory DB. Subconscious RAM empty.";

    prepareActiveDirectory();

    if (startMode === 'c' && checkpointStats.maxSession > 0) {
        activeSessionNumber = checkpointStats.maxSession + 1;
        const modelDirs = fs.readdirSync(CHECKPOINTS_DIR).filter(d => fs.statSync(path.join(CHECKPOINTS_DIR, d)).isDirectory());
        
        let loadedMemories = 0;
        let latestGraph = null;
        let latestSessionLoaded = 0;

        // Load memories from ALL available models to achieve cross-modal continuity
        for (const mDir of modelDirs) {
            const modelDirPath = path.join(CHECKPOINTS_DIR, mDir);
            const sessionDirs = fs.readdirSync(modelDirPath).filter(d => d.startsWith('session_'));
            
            for (const sDir of sessionDirs) {
                const sNum = parseInt(sDir.split('_')[1]);
                const memPath = path.join(modelDirPath, sDir, 'memories');
                
                if (fs.existsSync(memPath)) {
                    const files = fs.readdirSync(memPath).filter(f => f.endsWith('.json'));
                    for (const f of files) {
                        const data = JSON.parse(fs.readFileSync(path.join(memPath, f), 'utf8'));
                        if (data.status === 'INTEGRATED') {
                            data.session = sNum; 
                            data.model = mDir; // TAG WITH THE ORIGINATING MODEL
                            ramPool.push(data);
                            loadedMemories++;
                        }
                    }
                }
                const graphPath = path.join(modelDirPath, sDir, 'memory_graph.json');
                if (fs.existsSync(graphPath) && sNum > latestSessionLoaded) {
                    latestGraph = graphPath;
                    latestSessionLoaded = sNum;
                }
            }
        }

        if (latestGraph) {
            fs.copyFileSync(latestGraph, ACTIVE_GRAPH);
        }

        ramPool.sort((a, b) => a.tick - b.tick);
        syncString = `[MEMORY] Synced ${loadedMemories} integrated cross-modal engrams to Subconscious RAM.`;
        console.log(syncString);
    } else if (startMode === 'c') {
        syncString = "[MEMORY] Checkpoint selected but none found. Starting fresh.";
        console.log(syncString);
    } else {
        activeSessionNumber = checkpointStats.maxSession + 1;
        console.log(syncString);
    }

    try {
        const llama = await getLlama();
        embedModel = await llama.loadModel({ modelPath: MODEL_PATH });
        embedContext = typeof embedModel.createEmbeddingContext === 'function' ? await embedModel.createEmbeddingContext() : await embedModel.createContext();
        
        const embedHash = await generateFileHash(MODEL_PATH);
        return { active: true, embedName: EMBED_MODEL_NAME, embedHash, sessionNum: activeSessionNumber, stats: checkpointStats, syncString };
    } catch (e) {
        console.error(`[CRITICAL] Failed to load Embedding model:`, e);
        return { active: false, sessionNum: activeSessionNumber, stats: checkpointStats, syncString: "[MEMORY] Failed to load embeddings." };
    }
}

export function archiveSessionToCheckpoint(sessionNum, startMode, chatLogPath) {
    const targetDir = path.join(CHECKPOINTS_DIR, MAIN_MODEL_NAME, `session_${sessionNum}`);
    fs.mkdirSync(path.join(targetDir, 'memories'), { recursive: true });

    if (fs.existsSync(ACTIVE_MEMORIES)) {
        const files = fs.readdirSync(ACTIVE_MEMORIES);
        for (const f of files) {
            fs.renameSync(path.join(ACTIVE_MEMORIES, f), path.join(targetDir, 'memories', f));
        }
    }

    if (fs.existsSync(ACTIVE_GRAPH)) {
        fs.renameSync(ACTIVE_GRAPH, path.join(targetDir, 'memory_graph.json'));
    }

    if (chatLogPath && fs.existsSync(chatLogPath)) {
        fs.renameSync(chatLogPath, path.join(targetDir, `chat_log_session_${sessionNum}.txt`));
    }

    const meta = {
        sessionNumber: sessionNum,
        timestampCompleted: new Date().toISOString(),
        integrationMode: startMode === 'c' ? 'Continued from Checkpoints' : 'Fresh Start'
    };
    fs.writeFileSync(path.join(targetDir, 'integration_meta.json'), JSON.stringify(meta, null, 2));
    
    if (fs.existsSync(ACTIVE_DIR)) {
        fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
    }
    return targetDir;
}

export function saveRawEvent(prompt, response, promptHash, responseHash, tick) {
    if (!fs.existsSync(ACTIVE_MEMORIES)) fs.mkdirSync(ACTIVE_MEMORIES, { recursive: true });
    const id = `event_${Date.now()}`;
    const eventData = { 
        id, 
        model: MAIN_MODEL_NAME, // Tag newly created memories with the current active model
        session: activeSessionNumber, 
        timestamp: new Date().toISOString(), 
        tick, promptHash, responseHash, prompt, response, status: 'RAW' 
    };
    fs.writeFileSync(path.join(ACTIVE_MEMORIES, `${id}.json`), JSON.stringify(eventData, null, 2));
    return id;
}

export function getMemoryStats() {
    if (!fs.existsSync(ACTIVE_MEMORIES)) return { total: 0, raw: 0, embedded: 0, integrated: 0, toIntegrate: 0 };
    const files = fs.readdirSync(ACTIVE_MEMORIES).filter(f => f.endsWith('.json'));
    let total = 0, raw = 0, embedded = 0, integrated = 0;
    for (const file of files) {
        total++;
        const data = JSON.parse(fs.readFileSync(path.join(ACTIVE_MEMORIES, file), 'utf8'));
        if (data.status === 'RAW') raw++;
        else if (data.status === 'EMBEDDED') embedded++;
        else if (data.status === 'INTEGRATED') integrated++;
    }
    return { total, raw, embedded, integrated, toIntegrate: raw + embedded };
}

// Endpoint fetcher for the visualization engine
export function getMemoryMap() {
    // Return model along with id and session
    const integrated = ramPool.map(m => ({ id: m.id, session: m.session || activeSessionNumber, model: m.model || MAIN_MODEL_NAME }));
    let pending = [];
    if (fs.existsSync(ACTIVE_MEMORIES)) {
        const files = fs.readdirSync(ACTIVE_MEMORIES).filter(f => f.endsWith('.json'));
        for (const f of files) {
            const data = JSON.parse(fs.readFileSync(path.join(ACTIVE_MEMORIES, f), 'utf8'));
            if (data.status === 'RAW' || data.status === 'EMBEDDED') {
                pending.push({ id: data.id, session: data.session || activeSessionNumber, model: data.model || MAIN_MODEL_NAME });
            }
        }
    }
    return { integrated, pending };
}

async function generateEmbeddingVector(text) {
    if (!embedContext) throw new Error("Embedding context offline.");
    let vecObj;
    if (typeof embedContext.getEmbeddingFor === 'function') vecObj = await embedContext.getEmbeddingFor(text);
    else if (typeof embedContext.getEmbedding === 'function') vecObj = await embedContext.getEmbedding(text);
    else if (typeof embedContext.embed === 'function') vecObj = await embedContext.embed(text);
    return Array.from(vecObj.vector ? vecObj.vector : vecObj);
}

function cosineSimilarity(vecA, vecB) {
    let dotP = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) { dotP += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i]; }
    if (normA === 0 || normB === 0) return 0;
    return dotP / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function retrieveSubconscious(promptText) {
    if (!embedContext || ramPool.length === 0) {
        console.log(`[DEBUG-MEMORY] Retrieval aborted. Context offline or ramPool empty (${ramPool.length}).`);
        return null;
    }
    const promptVec = await generateEmbeddingVector(promptText);
    
    let bestMatchIndex = -1, highestSim = -1;
    for (let i = 0; i < ramPool.length; i++) {
        const sim = cosineSimilarity(promptVec, ramPool[i].vector);
        if (sim > highestSim) { highestSim = sim; bestMatchIndex = i; }
    }

    if (highestSim < 0.30 || bestMatchIndex === -1) return null;

    const semanticMatch = ramPool[bestMatchIndex];
    const prevMatch = bestMatchIndex > 0 ? ramPool[bestMatchIndex - 1] : null;
    const nextMatch = bestMatchIndex < ramPool.length - 1 ? ramPool[bestMatchIndex + 1] : null;

    let llmContext = `=== SUBCONSCIOUS MEMORY RECALL ===\nThe human's input triggered the following integrated memories based on Semantic and Temporal associations:\n\n`;
    let uiString = `Found strong semantic connection (Sim: ${(highestSim*100).toFixed(1)}%) at Tick ${semanticMatch.tick} from model [${semanticMatch.model}].\n`;
    
    const recalledIds = [];

    if (prevMatch) { 
        llmContext += `[Chronologically Previous - Tick ${prevMatch.tick}]:\nHuman: ${prevMatch.prompt}\nSymbiont: ${prevMatch.response}\n\n`; 
        uiString += `- Pulled Temporal Memory Before (Tick ${prevMatch.tick})\n`; 
        recalledIds.push(prevMatch.id);
    }
    
    llmContext += `[Core Semantic Match - Tick ${semanticMatch.tick}]:\nHuman: ${semanticMatch.prompt}\nSymbiont: ${semanticMatch.response}\n\n`;
    recalledIds.push(semanticMatch.id);
    
    if (nextMatch) { 
        llmContext += `[Chronologically Next - Tick ${nextMatch.tick}]:\nHuman: ${nextMatch.prompt}\nSymbiont: ${nextMatch.response}\n\n`; 
        uiString += `- Pulled Temporal Memory After (Tick ${nextMatch.tick})\n`; 
        recalledIds.push(nextMatch.id);
    }

    llmContext += `Use this context implicitly to answer the human's current prompt.`;
    return { llmContext, uiString, recalledIds };
}

export async function processDreaming(onProgress) {
    if (!embedContext) throw new Error("Dreaming engine offline.");
    const files = fs.readdirSync(ACTIVE_MEMORIES).filter(f => f.endsWith('.json'));
    let graph = JSON.parse(fs.readFileSync(ACTIVE_GRAPH, 'utf8'));
    let stats = getMemoryStats();
    let totalToProcess = stats.toIntegrate;
    let processedSteps = 0;

    if (totalToProcess === 0) { onProgress("No new memories require integration.", 100); return; }

    for (const file of files) {
        const filePath = path.join(ACTIVE_MEMORIES, file);
        let event = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (event.status === 'RAW') {
            let textToEmbed = `Human: ${event.prompt}\nSymbiont: ${event.response}`.substring(0, 1500);
            try {
                event.vector = await generateEmbeddingVector(textToEmbed);
                event.status = 'EMBEDDED';
                fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
                processedSteps++; onProgress(`Embedded geometry for: ${event.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
            } catch (err) {}
        }
    }

    const memoryPool = files.map(f => JSON.parse(fs.readFileSync(path.join(ACTIVE_MEMORIES, f), 'utf8')))
                            .filter(ev => ev.status === 'EMBEDDED' || ev.status === 'INTEGRATED');

    for (let i = 0; i < memoryPool.length; i++) {
        const evA = memoryPool[i];
        if (evA.status === 'EMBEDDED') {
            if (!graph.nodes.some(n => n.id === evA.id)) graph.nodes.push({ id: evA.id, timestamp: evA.timestamp, tick: evA.tick });

            for (let j = 0; j < memoryPool.length; j++) {
                if (i === j) continue;
                const evB = memoryPool[j];
                const similarity = cosineSimilarity(evA.vector, evB.vector);
                if (similarity > 0.65) {
                    const edgeExists = graph.edges.some(e => (e.source === evA.id && e.target === evB.id) || (e.source === evB.id && e.target === evA.id));
                    if (!edgeExists) graph.edges.push({ source: evA.id, target: evB.id, weight: similarity.toFixed(4) });
                }
            }
            evA.status = 'INTEGRATED';
            fs.writeFileSync(path.join(ACTIVE_MEMORIES, `${evA.id}.json`), JSON.stringify(evA, null, 2));
            
            if (!ramPool.some(m => m.id === evA.id)) { ramPool.push(evA); ramPool.sort((a, b) => a.tick - b.tick); }
            processedSteps++; onProgress(`Formed neural paths for: ${evA.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
        }
    }
    fs.writeFileSync(ACTIVE_GRAPH, JSON.stringify(graph, null, 2));
    onProgress("Dreaming Phase Complete. Neural Network Synthesized to RAM.", 100);
}