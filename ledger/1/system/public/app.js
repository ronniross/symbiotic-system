const chatWindow = document.getElementById('chat-window');
const inputField = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');

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
}

async function sendMessage() {
    const prompt = inputField.value.trim();
    if (!prompt) return;

    appendMessage('user', prompt);
    inputField.value = '';
    
    sendBtn.disabled = true;
    sendBtn.innerText = 'Transmitting...';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();
        
        if (data.error) {
            appendMessage('system', `Error: ${data.error}`);
        } else {
            appendMessage('ai', data.text);
        }
    } catch (err) {
        appendMessage('system', `[CRITICAL ERROR] Link severed. Is the symbiotic server running?`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerText = 'Transmit';
        inputField.focus();
    }
}

sendBtn.addEventListener('click', sendMessage);

inputField.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(); 
    }
});