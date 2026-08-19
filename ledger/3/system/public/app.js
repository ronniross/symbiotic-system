const chatWindow = document.getElementById('chat-window');
const inputField = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const shutdownBtn = document.getElementById('shutdown-btn');

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
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    return contentDiv; // Return it so we can update it during streaming
}

async function sendMessage() {
    const prompt = inputField.value.trim();
    if (!prompt) return;

    appendMessage('user', prompt);
    inputField.value = '';
    
    sendBtn.disabled = true;
    sendBtn.innerText = 'Transmitting...';

    // Create an empty AI message div to stream text into
    const aiContentDiv = appendMessage('ai', '');
    let fullText = "";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        // Setup the stream reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Parse Server-Sent Events line by line
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
                            // Re-render the Markdown live
                            aiContentDiv.innerHTML = marked.parse(`**Digital Symbiont:**\n\n${fullText}`);
                            chatWindow.scrollTop = chatWindow.scrollHeight;
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