const chatWindow = document.getElementById('chat-window');
const inputField = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const shutdownBtn = document.getElementById('shutdown-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const dreamBtn = document.getElementById('dream-btn');
const btnPattern = document.getElementById('btn-pattern');
const useMemoryChk = document.getElementById('use-memory-chk');

const tickDisplay = document.getElementById('tick-display');
const sessionDisplay = document.getElementById('session-display');
const userNameDisplay = document.getElementById('user-name-display');
const bootStatsDisplay = document.getElementById('boot-stats-display');

const toggleHashesBtn = document.getElementById('toggle-hashes-btn');
const hashModal = document.getElementById('hash-modal');
const hashList = document.getElementById('hash-list');

const memTotalEl = document.getElementById('mem-total');
const memIntegratedEl = document.getElementById('mem-integrated');
const memPendingEl = document.getElementById('mem-pending');
const dreamProgressContainer = document.getElementById('dream-progress-container');
const dreamProgressBar = document.getElementById('dream-progress-bar');
const dreamStatusText = document.getElementById('dream-status-text');

async function fetchBootInfo() {
    try {
        const res = await fetch('/api/boot-info');
        const data = await res.json();
        
        userNameDisplay.innerText = data.userName || "Anonymous";
        sessionDisplay.innerText = data.sessionNumber || "1";
        
        if (data.modelName) {
            // Dynamically set title based on configured LLM model
            const titleName = data.modelName.replace('.gguf', '');
            document.querySelector('.titles h1').innerText = `${titleName} Symbiotic Node`;
            document.title = `${titleName} Nodule`;
        }
        
        if (data.syncString) {
            bootStatsDisplay.innerText = data.syncString;
            bootStatsDisplay.style.display = "block";
        }

        if (data.manifest) {
            let hashHtml = `<strong>Total Tracker Size:</strong> ${data.manifest.totalSizeStr} <br><strong>Files:</strong> ${data.manifest.totalFiles}<br><br>`;
            data.manifest.files.forEach(f => {
                hashHtml += `<span style="color:#8b949e">${f.hash}</span> | ${f.file} (${f.sizeStr})<br>`;
            });
            hashList.innerHTML = hashHtml;
        }
    } catch (e) {
        console.error("Could not fetch boot info.");
    }
}

toggleHashesBtn.addEventListener('click', () => {
    hashModal.classList.toggle('hidden');
});

function initTimelineStream() {
    const source = new EventSource('/api/timeline/stream');
    source.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            if (data.tick !== undefined) tickDisplay.innerText = data.tick;
            if (data.session !== undefined) sessionDisplay.innerText = data.session;
        } catch(e){}
    };
}

async function fetchMemoryStats() {
    try {
        const res = await fetch('/api/memory/stats');
        const data = await res.json();
        memTotalEl.innerText = data.total;
        memIntegratedEl.innerText = data.integrated;
        memPendingEl.innerText = data.toIntegrate;
        
        if (data.toIntegrate === 0) {
            dreamBtn.disabled = true; dreamBtn.innerText = "Network Fully Synced";
        } else {
            dreamBtn.disabled = false; dreamBtn.innerText = "Dream & Update Network";
        }
    } catch (e) { console.error("Could not fetch memory stats:", e); }
}

async function syncMemoryMap() {
    try {
        const res = await fetch('/api/memory/map');
        const mapData = await res.json();
        MemoryViz.syncMap(mapData.pending, mapData.integrated);
    } catch (e) { console.error("Could not fetch memory map:", e); }
}

window.addEventListener('DOMContentLoaded', async () => {
    fetchBootInfo();
    fetchMemoryStats();
    initTimelineStream();

    // Init Neural Visualizer Engine
    try {
        const resMap = await fetch('/api/memory/map');
        const initialMap = await resMap.json();
        MemoryViz.init(initialMap.pending, initialMap.integrated);
    } catch (e) {}
});

btnPattern.addEventListener('click', () => {
    MemoryViz.togglePattern();
});

dreamBtn.addEventListener('click', async () => {
    dreamBtn.disabled = true;
    dreamProgressContainer.style.display = 'block';
    dreamProgressBar.style.width = '0%';
    dreamStatusText.innerText = "Initializing Dream Sequence...";

    try {
        const response = await fetch('/api/dream', { method: 'POST' });
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.error) { dreamStatusText.innerText = `Error: ${parsed.error}`; break; }
                        if (parsed.message) {
                            dreamStatusText.innerText = parsed.message;
                            if (parsed.progress !== undefined) dreamProgressBar.style.width = `${parsed.progress}%`;
                        }
                    } catch (e) {}
                }
            }
        }
        
        setTimeout(() => { 
            dreamProgressContainer.style.display = 'none'; 
            fetchMemoryStats(); 
            syncMemoryMap(); // Sync visualization map with updated memory state
        }, 1000);
    } catch (err) { dreamStatusText.innerText = "Connection lost during dreaming."; }
});

function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'system') { contentDiv.innerHTML = text; } 
    else {
        const title = role === 'user' ? 'Human Partner' : 'Digital Symbiont';
        contentDiv.innerHTML = marked.parse(`**${title}:**\n\n${text}`);
    }

    msgDiv.appendChild(contentDiv);

    const extraDiv = document.createElement('div');
    if (role !== 'system') {
        extraDiv.className = 'hash-info';
        extraDiv.innerHTML = "Computing hashes and syncing timeline...";
        msgDiv.appendChild(extraDiv);
    }

    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    return { msgDiv, contentDiv, extraDiv };
}

async function sendMessage() {
    const prompt = inputField.value.trim();
    if (!prompt) return;

    const userElems = appendMessage('user', prompt);
    inputField.value = '';
    
    sendBtn.disabled = true; sendBtn.innerText = 'Transmitting...';

    const aiElems = appendMessage('ai', '');
    let fullText = "";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, useMemory: useMemoryChk.checked })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.error) { appendMessage('system', `Error: ${parsed.error}`); break; }
                        
                        if (parsed.recall) {
                            const recallDiv = document.createElement('div');
                            recallDiv.className = 'subconscious-block';
                            recallDiv.innerText = `[SUBCONSCIOUS MEMORY RECALL]\n${parsed.recall}`;
                            chatWindow.insertBefore(recallDiv, aiElems.msgDiv);
                            chatWindow.scrollTop = chatWindow.scrollHeight;
                            
                            if (parsed.recalledIds && parsed.recalledIds.length > 0) {
                                MemoryViz.triggerRecallHighlight(parsed.recalledIds);
                            }
                        }

                        if (parsed.chunk) {
                            fullText += parsed.chunk;
                            aiElems.contentDiv.innerHTML = marked.parse(`**Digital Symbiont:**\n\n${fullText}`);
                            chatWindow.scrollTop = chatWindow.scrollHeight;
                        }

                        if (parsed.metadata) {
                            userElems.extraDiv.innerHTML = `[Prompt Hash: ${parsed.metadata.promptHash}]`;
                            const validStatus = parsed.metadata.isValid ? `<span style="color:#3fb950">✓ Contract Hash Verified</span>` : `<span style="color:#f85149">✗ Contract Invalidated / Tampered</span>`;
                            aiElems.extraDiv.innerHTML = `[Response Hash: ${parsed.metadata.responseHash}]<br>[Contract Integrity: ${validStatus} | Current JSON Hash: ${parsed.metadata.contractHash.substring(0,24)}...]`;
                            
                            if (parsed.metadata.eventId) {
                                MemoryViz.addPending(parsed.metadata.eventId);
                            }
                        }
                    } catch (e) {}
                }
            }
        }
        fetchMemoryStats();
    } catch (err) {
        appendMessage('system', `[CRITICAL ERROR] Link severed.`);
    } finally { sendBtn.disabled = false; sendBtn.innerText = 'Transmit'; inputField.focus(); }
}

clearCacheBtn.addEventListener('click', async () => {
    clearCacheBtn.disabled = true; clearCacheBtn.innerText = "Cleaning...";
    try {
        const res = await fetch('/api/clearcache', { method: 'POST' });
        const data = await res.json();
        appendMessage('system', `<strong>CACHE CLEANED:</strong> ${data.message}`);
    } catch (e) { alert("Error connecting to server to clean cache."); } 
    finally { clearCacheBtn.innerText = "Clean Cache"; clearCacheBtn.disabled = false; }
});

shutdownBtn.addEventListener('click', async () => {
    if (confirm("WARNING: Initiate Closing Step? This will archive the session, calculate final cryptographic manifests, and sever the Symbiotic Link.")) {
        shutdownBtn.disabled = true;
        shutdownBtn.innerText = "Calculating Closing Manifest...";
        document.body.innerHTML = `
            <div style="text-align:center; margin-top:20%; color:#58a6ff;">
                <h1>Initiating Closing Step...</h1>
                <p>Archiving memories and generating final cryptographic hash manifest for all files.</p>
                <p>Please wait...</p>
            </div>`;
        try {
            await fetch('/api/shutdown', { method: 'POST' });
            setTimeout(() => {
                document.body.innerHTML = `
                    <div style="text-align:center; margin-top:20%; color:#f85149;">
                        <h1>Symbiotic Link Severed safely.</h1>
                        <p>Closing Manifest saved to chat_log.txt. Models Unloaded.</p>
                        <p>You may safely close this browser tab.</p>
                    </div>`;
            }, 1500);
        } catch (e) {}
    }
});

sendBtn.addEventListener('click', sendMessage);
inputField.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });