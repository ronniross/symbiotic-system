import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLlama } from 'node-llama-cpp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const EVENTS_DIR = path.join(DATA_DIR, 'memories');
const GRAPH_FILE = path.join(DATA_DIR, 'memory_graph.json');

// Ensure necessary directories exist
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
if (!fs.existsSync(GRAPH_FILE)) {
    fs.writeFileSync(GRAPH_FILE, JSON.stringify({ nodes: [], edges: [] }, null, 2));
}

let embedModel = null;
let embedContext = null;

export async function initMemory() {
    console.log('\n--- INITIALIZING DREAM ENGINE & EMBEDDINGS ---');
    const MODEL_PATH = path.join(__dirname, '../../models/all-MiniLM-L6-v2-ggml-model-f16.gguf');
    
    if (!fs.existsSync(MODEL_PATH)) {
        console.warn(`[WARNING] Embedding model not found at ${MODEL_PATH}. Dreaming will be disabled.`);
        return;
    }

    try {
        const llama = await getLlama();
        embedModel = await llama.loadModel({ modelPath: MODEL_PATH });
        
        // node-llama-cpp v3 API for embeddings
        if (embedModel.createEmbeddingContext) {
            embedContext = await embedModel.createEmbeddingContext();
        } else {
            embedContext = await embedModel.createContext();
        }
        console.log(`[MEMORY] Embedding Model (all-MiniLM-L6-v2) loaded successfully.`);
    } catch (e) {
        console.error(`[CRITICAL] Failed to load Embedding model:`, e);
    }
}

export function saveRawEvent(prompt, response, promptHash, responseHash, tick) {
    const id = `event_${Date.now()}`;
    const eventData = {
        id,
        timestamp: new Date().toISOString(),
        tick,
        promptHash,
        responseHash,
        prompt,
        response,
        status: 'RAW' // State Machine: RAW -> EMBEDDED -> INTEGRATED
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
    if (!embedContext) throw new Error("Embedding context not initialized.");
    
    // Support varying API structures in node-llama-cpp
    let vectorObj;
    if (embedContext.getEmbedding) {
        vectorObj = await embedContext.getEmbedding(text);
    } else if (embedContext.embed) {
        vectorObj = await embedContext.embed(text);
    } else {
        throw new Error("No valid embedding execution method found in context.");
    }
    
    // Convert generic returned arrays/Float32Arrays into standard arrays
    return Array.from(vectorObj);
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function processDreaming(onProgress) {
    if (!embedContext) throw new Error("Dreaming engine offline (Embedding model missing).");
    
    const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    let graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    let stats = getMemoryStats();
    let totalToProcess = stats.toIntegrate;
    let processedSteps = 0;

    if (totalToProcess === 0) {
        onProgress("No new memories require integration.", 100);
        return;
    }

    // PHASE 1: Transform text into semantic geometry (RAW -> EMBEDDED)
    for (const file of files) {
        const filePath = path.join(EVENTS_DIR, file);
        let event = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (event.status === 'RAW') {
            const textToEmbed = `Human: ${event.prompt}\nSymbiont: ${event.response}`;
            try {
                const vector = await generateEmbeddingVector(textToEmbed);
                event.vector = vector;
                event.status = 'EMBEDDED';
                fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
                
                processedSteps++;
                // Progress scale: Phase 1 is roughly 50% of the work
                onProgress(`Embedded geometry for: ${event.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
            } catch (err) {
                console.error(`[DREAM ERROR] Failed to embed ${event.id}:`, err);
            }
        }
    }

    // PHASE 2: Neural Network Relational Mapping (EMBEDDED -> INTEGRATED)
    // Gather all entities capable of forming relationships
    const memoryPool = [];
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf8'));
        if (data.status === 'EMBEDDED' || data.status === 'INTEGRATED') {
            memoryPool.push(data);
        }
    }

    for (let i = 0; i < memoryPool.length; i++) {
        const evA = memoryPool[i];
        if (evA.status === 'EMBEDDED') {
            
            // 1. Ensure node exists in graph purely as structural metadata (NO TEXT SAVED)
            if (!graph.nodes.some(n => n.id === evA.id)) {
                graph.nodes.push({ id: evA.id, timestamp: evA.timestamp, tick: evA.tick });
            }

            // 2. Discover semantic relationships across the rest of the pool
            for (let j = 0; j < memoryPool.length; j++) {
                if (i === j) continue;
                const evB = memoryPool[j];
                const similarity = cosineSimilarity(evA.vector, evB.vector);

                // If relationship crosses similarity threshold, form an Edge
                if (similarity > 0.65) {
                    const edgeExists = graph.edges.some(e => 
                        (e.source === evA.id && e.target === evB.id) || 
                        (e.source === evB.id && e.target === evA.id)
                    );
                    if (!edgeExists) {
                        graph.edges.push({ source: evA.id, target: evB.id, weight: similarity.toFixed(4) });
                    }
                }
            }

            evA.status = 'INTEGRATED';
            fs.writeFileSync(path.join(EVENTS_DIR, `${evA.id}.json`), JSON.stringify(evA, null, 2));
            
            processedSteps++;
            onProgress(`Formed neural paths for: ${evA.id}`, Math.round((processedSteps / (totalToProcess * 2)) * 100));
        }
    }

    // Save newly grown Neural Network structure
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
    onProgress("Dreaming Phase Complete. Neural Network Synthesized.", 100);
}