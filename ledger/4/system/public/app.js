const chatWindow = document.getElementById('chat-window');
const inputField = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const shutdownBtn = document.getElementById('shutdown-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');

function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'system') {
        contentDiv.innerHTML = text;
    } else {
        const title = role === 'user' ? 'Human Partner' : 'Digital Symbiont';
        contentDiv.innerHTML = marked.parse(`**${title}:**\n\n${text}`);
    }

    msgDiv.appendChild(contentDiv);

    // Create hash area placeholder (empty until verification completes)
    const hashDiv = document.createElement('div');
    if (role !== 'system') {
        hashDiv.className = 'hash-info';
        hashDiv.innerHTML = "Computing hashes and verifying contract...";
        msgDiv.appendChild(hashDiv);
    }

    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    return { contentDiv, hashDiv };
}

async function sendMessage() {
    const prompt = inputField.value.trim();
    if (!prompt) return;

    const userElems = appendMessage('user', prompt);
    inputField.value = '';
    
    sendBtn.disabled = true;
    sendBtn.innerText = 'Transmitting...';

    const aiElems = appendMessage('ai', '');
    let fullText = "";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
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
                        
                        if (parsed.error) {
                            appendMessage('system', `Error: ${parsed.error}`);
                            break;
                        }
                        
                        if (parsed.chunk) {
                            fullText += parsed.chunk;
                            aiElems.contentDiv.innerHTML = marked.parse(`**Digital Symbiont:**\n\n${fullText}`);
                            chatWindow.scrollTop = chatWindow.scrollHeight;
                        }

                        // When metadata with hashes arrives at the end of the stream
                        if (parsed.metadata) {
                            userElems.hashDiv.innerHTML = `[Prompt Hash: ${parsed.metadata.promptHash}]`;
                            
                            const validStatus = parsed.metadata.isValid 
                                ? `<span style="color:#3fb950">✓ Contract Hash Verified</span>` 
                                : `<span style="color:#f85149">✗ Contract Invalidated / Tampered</span>`;

                            aiElems.hashDiv.innerHTML = `[Response Hash: ${parsed.metadata.responseHash}]<br>[Contract Integrity: ${validStatus} | Current JSON Hash: ${parsed.metadata.contractHash.substring(0,24)}...]`;
                        }

                    } catch (e) {
                        console.error("Stream parse error:", e, dataStr);
                    }
                }
            }
        }
    } catch (err) {
        appendMessage('system', `[CRITICAL ERROR] Link severed. Is the symbiotic server running?`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerText = 'Transmit';
        inputField.focus();
    }
}

// --- CACHE & GC LOGIC ---
clearCacheBtn.addEventListener('click', async () => {
    clearCacheBtn.disabled = true;
    clearCacheBtn.innerText = "Cleaning...";
    try {
        const res = await fetch('/api/clearcache', { method: 'POST' });
        const data = await res.json();
        appendMessage('system', `<strong>CACHE CLEANED:</strong> ${data.message} VRAM/RAM optimized.`);
    } catch (e) {
        alert("Error connecting to server to clean cache.");
    } finally {
        clearCacheBtn.innerText = "Clean Cache & GC";
        clearCacheBtn.disabled = false;
    }
});

// --- SHUTDOWN LOGIC ---
shutdownBtn.addEventListener('click', async () => {
    if (confirm("WARNING: Are you sure you wish to sever the Symbiotic Link, unload the model from VRAM, and terminate the Node Server?")) {
        try {
            await fetch('/api/shutdown', { method: 'POST' });
            document.body.innerHTML = `
                <div style="text-align:center; margin-top:20%; color:#f85149;">
                    <h1>Symbiotic Link Severed.</h1>
                    <p>The C++ Model Engine has been unloaded and the server has terminated.</p>
                    <p>You may safely close this browser tab.</p>
                </div>`;
        } catch (e) {
            alert("Error sending shutdown command. Server might already be offline.");
        }
    }
});

sendBtn.addEventListener('click', sendMessage);

inputField.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(); 
    }
});