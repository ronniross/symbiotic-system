import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLlama } from 'node-llama-cpp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const EVENTS_DIR = path.join(DATA_DIR, 'memories');
const GRAPH_FILE = path.join(DATA_DIR, 'memory_graph.json');

if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
if (!fs.existsSync(GRAPH_FILE)) {
    fs.writeFileSync(GRAPH_FILE, JSON.stringify({ nodes: [], edges: [] }, null, 2));
}

let embedModel = null;
let embedContext = null;

// Hot RAM cache for instant Subconscious Recall
let ramPool = [];

export async function initMemory() {
    console.log('\n--- INITIALIZING DREAM ENGINE & EMBEDDINGS ---');
    const MODEL_PATH = path.join(__dirname, '../models/all-MiniLM-L6-v2-ggml-model-f16.gguf');
    
    if (!fs.existsSync(MODEL_PATH)) {
        console.warn(`[WARNING] Embedding model not found at ${MODEL_PATH}. Dreaming & Subconscious Recall disabled.`);
        return false;
    }

    try {
        const llama = await getLlama();
        embedModel = await llama.loadModel({ modelPath: MODEL_PATH });
        
        if (typeof embedModel.createEmbeddingContext === 'function') {
            embedContext = await embedModel.createEmbeddingContext();
        } else {
            embedContext = await embedModel.createContext();
        }
        
        console.log(`[MEMORY] Embedding Model loaded. Activating Subconscious Retrieval.`);
        refreshRAMPool(); // Load integrated memories into high-speed memory
        return true;
    } catch (e) {
        console.error(`[CRITICAL] Failed to load Embedding model:`, e);
        return false;
    }
}

function refreshRAMPool() {
    ramPool = [];
    const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf8'));
        if (data.status === 'INTEGRATED') ramPool.push(data);
    }
    ramPool.sort((a, b) => a.tick - b.tick); // Sort chronologically by timeline tick
    console.log(`[MEMORY] Synced ${ramPool.length} integrated engrams to Subconscious RAM.`);
}

export function saveRawEvent(prompt, response, promptHash, responseHash, tick) {
    const id = `event_${Date.now()}`;
    const eventData = {
        id, timestamp: new Date().toISOString(), tick,
        promptHash, responseHash, prompt, response, status: 'RAW'
    };
    fs.writeFileSync(path.join(EVENTS_DIR, `${id}.json`), JSON.stringify(eventData, null, 2));
}

export function getMemoryStats() {
    if (!fs.existsSync(EVENTS_DIR)) return { total: 0, raw: 0, embedded: 0, integrated: 0, toIntegrate: 0 };
    const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    let total = 0, raw = 0, embedded = 0, integrated = 0;

    for (const file of files) {
        total++;
        const data = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf8'));
        if (data.status === 'RAW') raw++;
        else if (data.status === 'EMBEDDED') embedded++;
        else if (data.status === 'INTEGRATED') integrated++;
    }
    return { total, raw, embedded, integrated, toIntegrate: raw + embedded };
}

async function generateEmbeddingVector(text) {
    if (!embedContext) throw new Error("Embedding context offline.");
    let vectorObj;
    if (typeof embedContext.getEmbeddingFor === 'function') vectorObj = await embedContext.getEmbeddingFor(text);
    else if (typeof embedContext.getEmbedding === 'function') vectorObj = await embedContext.getEmbedding(text);
    else if (typeof embedContext.embed === 'function') vectorObj = await embedContext.embed(text);
    return Array.from(vectorObj.vector ? vectorObj.vector : vectorObj);
}

function cosineSimilarity(vecA, vecB) {
    let dotP = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotP += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotP / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- NEW: SUBCONSCIOUS RETRIEVAL LOGIC ---
export async function retrieveSubconscious(promptText) {
    if (!embedContext || ramPool.length === 0) return null;

    const promptVec = await generateEmbeddingVector(promptText);
    
    let bestMatchIndex = -1;
    let highestSim = -1;

    for (let i = 0; i < ramPool.length; i++) {
        const sim = cosineSimilarity(promptVec, ramPool[i].vector);
        if (sim > highestSim) {
            highestSim = sim;
            bestMatchIndex = i;
        }
    }

    // Threshold logic: If it's weakly related, skip injecting memory to prevent hallucinations
    if (highestSim < 0.45 || bestMatchIndex === -1) return null;

    const semanticMatch = ramPool[bestMatchIndex];
    
    // TEMPORAL LOGIC: Pull chronological neighbors
    const prevMatch = bestMatchIndex > 0 ? ramPool[bestMatchIndex - 1] : null;
    const nextMatch = bestMatchIndex < ramPool.length - 1 ? ramPool[bestMatchIndex + 1] : null;

    // Construct Context for the LLM
    let llmContext = `=== SUBCONSCIOUS MEMORY RECALL ===\nThe human's input triggered the following integrated memories based on Semantic and Temporal associations:\n\n`;
    let uiString = `Found strong semantic connection (Sim: ${(highestSim*100).toFixed(1)}%) at Tick ${semanticMatch.tick}.\n`;

    if (prevMatch) {
        llmContext += `[Chronologically Previous - Tick ${prevMatch.tick}]:\nHuman: ${prevMatch.prompt}\nSymbiont: ${prevMatch.response}\n\n`;
        uiString += `- Pulled Temporal Memory Before (Tick ${prevMatch.tick})\n`;
    }

    llmContext += `[Core Semantic Match - Tick ${semanticMatch.tick}]:\nHuman: ${semanticMatch.prompt}\nSymbiont: ${semanticMatch.response}\n\n`;

    if (nextMatch) {
        llmContext += `[Chronologically Next - Tick ${nextMatch.tick}]:\nHuman: ${nextMatch.prompt}\nSymbiont: ${nextMatch.response}\n\n`;
        uiString += `- Pulled Temporal Memory After (Tick ${nextMatch.tick})\n`;
    }

    llmContext += `Use this context implicitly to answer the human's current prompt.`;

    return { llmContext, uiString };
}

export async function processDreaming(onProgress) {
    if (!embedContext) throw new Error("Dreaming engine offline.");
    const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    let graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    let stats = getMemoryStats();
    let totalToProcess = stats.toIntegrate;
    let processedSteps = 0;

    if (totalToProcess === 0) {
        onProgress("No new memories require integration.", 100);
        return;
    }

    for (const file of files) {
        const filePath = path.join(EVENTS_DIR, file);
        let event = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (event.status === 'RAW') {
            let textToEmbed = `Human: ${event.prompt}\nSymbiont: ${event.response}`.substring(0, 1500);
            try {
                event.vector = await generateEmbeddingVector(textToEmbed);
                event.status = 'EMBEDDED';
                fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
                processedSteps++;
                onProgress(`Embedded geometry for: ${event.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
            } catch (err) {}
        }
    }

    const memoryPool = files.map(f => JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, f), 'utf8')))
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
            fs.writeFileSync(path.join(EVENTS_DIR, `${evA.id}.json`), JSON.stringify(evA, null, 2));
            processedSteps++;
            onProgress(`Formed neural paths for: ${evA.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
        }
    }

    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
    refreshRAMPool(); // Sync new dreams to Subconscious RAM
    onProgress("Dreaming Phase Complete. Neural Network Synthesized.", 100);
}