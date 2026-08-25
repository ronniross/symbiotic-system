import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export async function generateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

export async function generateSystemManifest(baseDir) {
    const manifest = [];
    
    // Ignore folders/files that are irrelevant or actively written to during boot.
    // 'chat_log.txt' is intentionally ignored during manifest scanning, but will be safely stored and closed at shutdown.
    const ignoreList = ['node_modules', '.git', 'chat_log.txt', 'root_folder.txt']; 
    let totalSize = 0;

    async function walk(dir) {
        if (!fs.existsSync(dir)) return;
        
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (ignoreList.includes(file)) continue;
            
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                await walk(filePath);
            } else {
                const hash = await generateFileHash(filePath);
                manifest.push({
                    file: path.relative(baseDir, filePath),
                    sizeBytes: stat.size,
                    sizeStr: formatBytes(stat.size),
                    hash: hash,
                    timestamp: new Date().toISOString()
                });
                totalSize += stat.size;
            }
        }
    }

    await walk(baseDir);
    return {
        timestamp: new Date().toISOString(),
        totalFiles: manifest.length,
        totalSizeStr: formatBytes(totalSize),
        files: manifest
    };
}