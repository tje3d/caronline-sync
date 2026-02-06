import { parse } from 'node-html-parser';
import * as fs from 'fs';
import * as path from 'path';
import { BaleSyncService } from './bale-sync';

// --- Configuration ---
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://t.me/s/caronline';
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 10;

function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// --- Helper: Download File ---
async function download(url: string, filepath: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
             throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
        }
        await Bun.write(filepath, res);
        log(`Downloaded ${path.basename(filepath)}`);
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

// --- Main Scraper ---
async function scrape() {
    log('Starting scraper...');
    if (!fs.existsSync(CACHE_DIR)) {
        log(`Creating cache directory at ${CACHE_DIR}`);
        fs.mkdirSync(CACHE_DIR);
    }

    // 1. Load existing data
    // We use a Map by ID to merge history and detect deletions
    const historyMap = new Map<string, Message>(); 
    const dataPath = path.join(CACHE_DIR, 'data.json');
    const dataFile = Bun.file(dataPath);
    
    if (await dataFile.exists()) {
        try {
            const loaded: Message[] = await dataFile.json();
            loaded.forEach(m => historyMap.set(m.id, m));
            log(`Loaded ${loaded.length} existing messages.`);
        } catch (e) {
            console.error(`[${new Date().toISOString()}] Error reading existing data`, e);
        }
    }

    // Helper to check for content duplicates
    const existingHashes = new Map(Array.from(historyMap.values()).filter(m => m.hash).map(m => [m.hash!, m]));

    log(`Fetching channel from ${CHANNEL_URL}...`);
    const res = await fetch(CHANNEL_URL);
    log(`Channel fetch status: ${res.status}`);
    const html = await res.text();

    const root = parse(html);
    const nodes = root.querySelectorAll('.tgme_widget_message_wrap').slice(-LIMIT);
    log(`Found ${nodes.length} message nodes to process.`);

    // Track IDs seen in THIS specific run to calculate the "deletion window"
    const currentRunIds: number[] = [];

    for (const node of nodes) {
        // IDs are usually in data-post="channel/123"
        const msgNode = node.querySelector('.tgme_widget_message');
        const msgIdStr = msgNode?.getAttribute('data-post')?.split('/')[1];
        const msgId = msgIdStr || Date.now().toString(); // Fallback

        if (msgIdStr) currentRunIds.push(parseInt(msgIdStr));

        // --- Extract Reply ID Only ---
        const replyHref = node.querySelector('.tgme_widget_message_reply')?.getAttribute('href');
        const replyTo = replyHref ? replyHref.split('/').pop() || null : null;

        // Extract Text
        const textNode = node.querySelector('.tgme_widget_message_text:not(.js-message_reply_text)');
        let text = '';
        if (textNode) {
            text = textNode.innerHTML
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/?b>/gi, '*')
                .replace(/&#33;/g, '!')
                .replace(/<[^>]+>/gi, ''); 
        }

        const mediaToDownload: string[] = [];

        // A. Photos
        const photos = node.querySelectorAll('.tgme_widget_message_photo_wrap');
        photos.forEach(photo => {
            const style = photo.getAttribute('style') || '';
            const match = style.match(/url\(['"]?(.+?)['"]?\)/);
            if (match) mediaToDownload.push(match[1]!);
        });

        // B. Videos & Voice
        const videos = node.querySelectorAll('video, audio');
        videos.forEach(media => {
            const src = media.getAttribute('src');
            if (src) mediaToDownload.push(src);
        });

        // Generate Content Hash
        const contentHash = Bun.hash(JSON.stringify({ text, media: mediaToDownload, replyTo })).toString();

        // 2. Logic: Unchanged vs New
        if (existingHashes.has(contentHash)) {
            // Message content exists. Retrieve it to keep the original file paths.
            const existingMsg = existingHashes.get(contentHash)!;
            
            // Important: If it was previously marked deleted, it is now alive again (re-check)
            existingMsg.isDeleted = false; 
            
            // Update the map (updates ID if the hash belonged to a diff ID, though unlikely)
            historyMap.set(msgId, existingMsg);
            // log(`Skipping unchanged message ${msgId}`);
            continue;
        }

        log(`Processing new/changed message ${msgId} with ${mediaToDownload.length} media files (ReplyTo: ${replyTo || 'None'}).`);

        // Download loop
        const savedFiles = [];
        try {
            for (let i = 0; i < mediaToDownload.length; i++) {
                const url = mediaToDownload[i]!;
                const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
                const filename = `${msgId}_${i}.${ext}`;
                
                log(`Downloading media ${i + 1}/${mediaToDownload.length}: ${url}`);
                await download(url, path.join(CACHE_DIR, filename));
                savedFiles.push(filename);
            }
        } catch (e: any) {
            log(`❌ Failed to download media for message ${msgId}, skipping save to retry later. Error: ${e.message}`);
            continue;
        }

        // Upsert into History Map
        historyMap.set(msgId, { 
            id: msgId, 
            text, 
            files: savedFiles, 
            hash: contentHash, 
            replyTo,
            isDeleted: false // Definitely alive if we just saw it
        });
    }

    // 3. Logic: Detect Deletions
    // If we have IDs [100, 101, 103] in this run, then 102 is deleted.
    // We only check within the range of IDs we actually fetched to avoid marking older unloaded messages as deleted.
    if (currentRunIds.length > 0) {
        const minId = Math.min(...currentRunIds);
        const seenSet = new Set(currentRunIds.map(String));

        for (const [id, msg] of historyMap) {
            const idNum = parseInt(id);
            // If the message is within the window of what we just looked at (or newer)...
            if (!isNaN(idNum) && idNum >= minId) {
                // ...but it was NOT seen in the HTML
                if (!seenSet.has(id)) {
                    if (!msg.isDeleted) {
                        msg.isDeleted = true;
                        log(`⚠️ Message ${id} detected as DELETED.`);
                    }
                }
            }
        }
    }

    // 4. Save Cache (Sort by ID for cleanliness)
    const sortedMessages = Array.from(historyMap.values()).sort((a, b) => parseInt(a.id) - parseInt(b.id));
    
    // Keep only the last 100 messages
    const messagesToSave = sortedMessages.slice(-100);

    log(`Saving ${messagesToSave.length} messages to cache...`);
    await Bun.write(path.join(CACHE_DIR, 'data.json'), JSON.stringify(messagesToSave, null, 2));
    log(`Success!`);
}


let isProcessing = false;
let baleService: BaleSyncService | null = null;

try {
    if (process.env.BALE_BOT_TOKEN && process.env.BALE_CHAT_ID) {
        baleService = new BaleSyncService();
    } else {
        log('⚠️ Bale sync skipped: Missing BALE_BOT_TOKEN or BALE_CHAT_ID');
    }
} catch (e) {
    console.error('Failed to initialize Bale Service', e);
}

async function run() {
    if (isProcessing) {
        log('Previous scrape still running, skipping...');
        return;
    }
    isProcessing = true;
    try {
        if (baleService) {
            await baleService.testConnection();
        }
        await scrape();
        
        if (baleService) {
            log('Starting Bale Sync...');
            await baleService.syncOnce();
            log('Bale Sync completed.');
        }
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Error in scrape loop`, e);
    } finally {
        isProcessing = false;
    }
}

// Run immediately on start
run();

// Then every 5 seconds
setInterval(run, 5000);