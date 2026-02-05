import { parse } from 'node-html-parser';
import * as fs from 'fs';
import * as path from 'path';

// --- Configuration ---
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://t.me/s/caronline';
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 10;

function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

interface Message {
    id: string;
    text: string;
    files: string[];
    hash?: string;
    replyTo: string | null;
}

// --- Helper: Download File ---
async function download(url: string, filepath: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
             console.error(`[${new Date().toISOString()}] Failed to fetch ${url}: ${res.status} ${res.statusText}`);
             return;
        }
        await Bun.write(filepath, res);
        log(`Downloaded ${path.basename(filepath)}`);
    } catch (e) {
        console.error(`[${new Date().toISOString()}] Error downloading ${url}`, e);
    }
}

// --- Main Scraper ---
async function scrape() {
    log('Starting scraper...');
    if (!fs.existsSync(CACHE_DIR)) {
        log(`Creating cache directory at ${CACHE_DIR}`);
        fs.mkdirSync(CACHE_DIR);
    }

    // Load existing data
    let existingMessages: Message[] = [];
    const dataPath = path.join(CACHE_DIR, 'data.json');
    const dataFile = Bun.file(dataPath);
    if (await dataFile.exists()) {
        try {
            existingMessages = await dataFile.json();
            log(`Loaded ${existingMessages.length} existing messages.`);
        } catch (e) {
            console.error(`[${new Date().toISOString()}] Error reading existing data`, e);
        }
    }
    const existingHashes = new Map(existingMessages.filter(m => m.hash).map(m => [m.hash!, m]));

    log(`Fetching channel from ${CHANNEL_URL}...`);
    const res = await fetch(CHANNEL_URL);
    log(`Channel fetch status: ${res.status}`);
    const html = await res.text();

    // 1. Parse HTML (Fast)
    const root = parse(html);

    // 2. Select Message Wrappers
    // node-html-parser uses standard querySelectorAll
    const nodes = root.querySelectorAll('.tgme_widget_message_wrap').slice(-LIMIT);
    log(`Found ${nodes.length} message nodes to process.`);
    const messages: Message[] = [];

    for (const node of nodes) {
        // IDs are usually in data-post="channel/123"
        const msgNode = node.querySelector('.tgme_widget_message');
        const msgId = msgNode?.getAttribute('data-post')?.split('/')[1] || Date.now().toString();

        // --- Extract Reply ID Only ---
        const replyHref = node.querySelector('.tgme_widget_message_reply')?.getAttribute('href');
        const replyTo = replyHref ? replyHref.split('/').pop() || null : null;

        // Extract Text (innerHTML to preserve <br>, then clean)
        const textNode = node.querySelector('.tgme_widget_message_text:not(.js-message_reply_text)');
        let text = '';
        if (textNode) {
            text = textNode.innerHTML
                .replace(/<br\s*\/?>/gi, '\n') // Turn breaks to newlines
                .replace(/<(?!\/?b\b)[^>]+>/gi, '');      // Strip other HTML tags except <b>
        }

        const mediaToDownload: string[] = [];

        // A. Photos (Background Images)
        const photos = node.querySelectorAll('.tgme_widget_message_photo_wrap');
        photos.forEach(photo => {
            const style = photo.getAttribute('style') || '';
            // Extract url('...')
            const match = style.match(/url\(['"]?(.+?)['"]?\)/);
            if (match) mediaToDownload.push(match[1]!);
        });

        // B. Videos & Voice (src attributes)
        const videos = node.querySelectorAll('video, audio');
        videos.forEach(media => {
            const src = media.getAttribute('src');
            if (src) mediaToDownload.push(src);
        });

        // Generate Content Hash
        // Use Bun's fast non-cryptographic hash (returns number, 64-bit)
        const contentHash = Bun.hash(JSON.stringify({ text, media: mediaToDownload, replyTo })).toString();

        if (existingHashes.has(contentHash)) {
            log(`Skipping unchanged message ${msgId}`);
            messages.push(existingHashes.get(contentHash)!);
            continue;
        }

        log(`Processing new/changed message ${msgId} with ${mediaToDownload.length} media files (ReplyTo: ${replyTo || 'None'}).`);

        // Download loop
        const savedFiles = [];
        for (let i = 0; i < mediaToDownload.length; i++) {
            const url = mediaToDownload[i]!;
            const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
            const filename = `${msgId}_${i}.${ext}`;
            
            log(`Downloading media ${i + 1}/${mediaToDownload.length}: ${url}`);
            await download(url, path.join(CACHE_DIR, filename));
            savedFiles.push(filename);
        }

        messages.push({ id: msgId, text, files: savedFiles, hash: contentHash, replyTo });
    }

    // Save Cache
    log(`Saving ${messages.length} messages to cache...`);
    await Bun.write(path.join(CACHE_DIR, 'data.json'), JSON.stringify(messages, null, 2));
    log(`Success! Scraped ${messages.length} messages.`);
}

scrape();