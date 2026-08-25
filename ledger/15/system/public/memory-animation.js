const MemoryViz = (function() {
    let pendingNodes = []; // leftBalls
    let integratedNodes = []; // rightBalls
    
    let time = 0;
    let centerX, targetX, centerY;
    const radius = 65; 
    
    const patterns = ['circular', 'triangular', 'aleatory', 'spiral', 'clusters'];
    let currentPatternIndex = 0;
    let animationFrameId = null;

    const layer = document.getElementById('animation-layer');

    function updateDimensions() {
        centerX = window.innerWidth * 0.15; // Left anchor (Pending)
        targetX = window.innerWidth * 0.85; // Right anchor (Integrated)
        centerY = window.innerHeight * 0.5;  
    }

    function createNode(id, startX, startY, session = null) {
        const el = document.createElement('div');
        el.className = 'ball';
        if (session !== null) el.classList.add('green');
        layer.appendChild(el);

        return {
            id: id,
            el: el,
            session: session,
            cx: startX, 
            cy: startY, 
            currX: startX,
            currY: startY
        };
    }

    function getTargetPosition(pattern, ball, index, total, cx, cy, t) {
        let tx = cx, ty = cy;
        const angle = t + (index / Math.max(1, total)) * Math.PI * 2;

        switch (pattern) {
            case 'circular':
                tx = cx + Math.cos(angle) * radius;
                ty = cy + Math.sin(angle) * radius;
                break;

            case 'triangular':
                let frac = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
                const p0 = { x: 0, y: -radius };
                const p1 = { x: radius * 0.866, y: radius * 0.5 };
                const p2 = { x: -radius * 0.866, y: radius * 0.5 };
                
                if (frac < 1/3) {
                    let f = frac * 3;
                    tx = cx + p0.x + (p1.x - p0.x) * f;
                    ty = cy + p0.y + (p1.y - p0.y) * f;
                } else if (frac < 2/3) {
                    let f = (frac - 1/3) * 3;
                    tx = cx + p1.x + (p2.x - p1.x) * f;
                    ty = cy + p1.y + (p2.y - p1.y) * f;
                } else {
                    let f = (frac - 2/3) * 3;
                    tx = cx + p2.x + (p0.x - p2.x) * f;
                    ty = cy + p2.y + (p0.y - p2.y) * f;
                }
                break;

            case 'aleatory':
                // Using index pseudo-randomness
                const numId = index * 10;
                const chaoticX = Math.sin(t * 0.8 + numId * 1.3) * Math.cos(t * 0.5 + numId * 0.7);
                const chaoticY = Math.cos(t * 0.7 + numId * 1.1) * Math.sin(t * 0.6 + numId * 0.9);
                tx = cx + chaoticX * radius * 1.5;
                ty = cy + chaoticY * radius * 1.5;
                break;

            case 'spiral':
                const spiralRadius = radius * (0.2 + 0.8 * Math.abs(Math.sin(t * 0.5 + index * 0.5)));
                const spiralAngle = t * 2 + index * 0.5;
                tx = cx + Math.cos(spiralAngle) * spiralRadius;
                ty = cy + Math.sin(spiralAngle) * spiralRadius;
                break;

            case 'clusters':
                const swarmRadius = 15 + Math.sin(t * 2 + index) * 5;
                const swarmAngle = t * 4 + index;
                tx = cx + Math.cos(swarmAngle) * swarmRadius;
                ty = cy + Math.sin(swarmAngle + index) * swarmRadius;
                break;
        }
        return { tx, ty };
    }

    function animate() {
        time += 0.02; 
        const currentPattern = patterns[currentPatternIndex];
        
        // --- 1. Pending Nodes (Left Side) ---
        pendingNodes.forEach((ball, index) => {
            ball.cx += (centerX - ball.cx) * 0.04;
            ball.cy += (centerY - ball.cy) * 0.04;
            const target = getTargetPosition(currentPattern, ball, index, pendingNodes.length, ball.cx, ball.cy, time);
            ball.currX += (target.tx - ball.currX) * 0.1;
            ball.currY += (target.ty - ball.currY) * 0.1;
            ball.el.style.transform = `translate(${ball.currX}px, ${ball.currY}px)`;
        });

        // --- 2. Integrated Nodes (Right Side, Grouped by Session) ---
        const sessions = [...new Set(integratedNodes.map(b => b.session))].sort();
        const sessionCenters = {};
        
        // Spread the clusters across the right side depending on screen width
        const macroRadius = Math.min(window.innerWidth * 0.1, 120); 

        sessions.forEach((sess, i) => {
            // Rotating macro-cluster
            const angle = (i / Math.max(1, sessions.length)) * Math.PI * 2 + (time * 0.1); 
            sessionCenters[sess] = {
                x: targetX + Math.cos(angle) * (sessions.length > 1 ? macroRadius : 0),
                y: centerY + Math.sin(angle) * (sessions.length > 1 ? macroRadius : 0)
            };
        });

        integratedNodes.forEach(ball => {
            const subCenter = sessionCenters[ball.session] || {x: targetX, y: centerY};
            
            ball.cx += (subCenter.x - ball.cx) * 0.04;
            ball.cy += (subCenter.y - ball.cy) * 0.04;

            const siblings = integratedNodes.filter(b => b.session === ball.session);
            const localIndex = siblings.indexOf(ball);

            const target = getTargetPosition(currentPattern, ball, localIndex, siblings.length, ball.cx, ball.cy, time);

            ball.currX += (target.tx - ball.currX) * 0.1;
            ball.currY += (target.ty - ball.currY) * 0.1;
            ball.el.style.transform = `translate(${ball.currX}px, ${ball.currY}px)`;
        });

        animationFrameId = requestAnimationFrame(animate);
    }

    return {
        init: function(initialPending, initialIntegrated) {
            updateDimensions();
            window.addEventListener('resize', updateDimensions);
            
            layer.innerHTML = '';
            pendingNodes = [];
            integratedNodes = [];

            initialPending.forEach(n => {
                pendingNodes.push(createNode(n.id, centerX, centerY, null));
            });

            initialIntegrated.forEach(n => {
                integratedNodes.push(createNode(n.id, targetX, centerY, n.session));
            });

            if (!animationFrameId) animate();
        },

        addPending: function(id) {
            if (!pendingNodes.find(n => n.id === id)) {
                pendingNodes.push(createNode(id, centerX, centerY, null));
            }
        },

        syncMap: function(newPendingList, newIntegratedList) {
            // Remove balls that no longer exist
            pendingNodes = pendingNodes.filter(b => {
                const stillExists = newPendingList.find(n => n.id === b.id);
                if (!stillExists) b.el.remove();
                return stillExists;
            });
            integratedNodes = integratedNodes.filter(b => {
                const stillExists = newIntegratedList.find(n => n.id === b.id);
                if (!stillExists) b.el.remove();
                return stillExists;
            });

            // If a pending node became integrated, move it
            newIntegratedList.forEach(n => {
                const isAlreadyIntegrated = integratedNodes.find(b => b.id === n.id);
                if (!isAlreadyIntegrated) {
                    const el = document.createElement('div');
                    el.className = 'ball green';
                    // Check if it's currently on screen (was pending) so it flies over
                    let startX = targetX;
                    let startY = centerY;
                    
                    const existingNodeInfo = newPendingList.find(pn => pn.id === n.id) || null;
                    if (existingNodeInfo) {
                        startX = centerX;
                    }
                    
                    layer.appendChild(el);
                    integratedNodes.push({
                        id: n.id, el: el, session: n.session, cx: startX, cy: startY, currX: startX, currY: startY
                    });
                }
            });
            
            // Add any fresh pending nodes
            newPendingList.forEach(n => {
                if (!pendingNodes.find(b => b.id === n.id)) {
                    pendingNodes.push(createNode(n.id, centerX, centerY, null));
                }
            });
        },

        triggerRecallHighlight: function(recalledIds) {
            integratedNodes.forEach(b => {
                if (recalledIds.includes(b.id)) {
                    b.el.classList.add('highlight');
                    // Remove highlight after a few seconds
                    setTimeout(() => {
                        b.el.classList.remove('highlight');
                    }, 2500);
                }
            });
        },

        togglePattern: function() {
            currentPatternIndex = (currentPatternIndex + 1) % patterns.length;
        }
    };
})();