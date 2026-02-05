import { parse } from 'node-html-parser';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// --- Configuration ---
const CHANNEL_URL = 'https://t.me/s/caronline';
const CACHE_DIR = path.join(__dirname, 'cache');
const LIMIT = 20;

interface Message {
    id: string;
    text: string;
    files: string[];
    hash?: string;
}

// --- Helper: Download File ---
async function download(url: string, filepath: string) {
    try {
        const res = await fetch(url);
        if (!res.ok || !res.body) return;
        // @ts-ignore: Readable.fromWeb requires Node 18+
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(filepath));
    } catch (e) {
        console.error(`Error downloading ${url}`);
    }
}

// --- Main Scraper ---
async function scrape() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

    // Load existing data
    let existingMessages: Message[] = [];
    const dataPath = path.join(CACHE_DIR, 'data.json');
    if (fs.existsSync(dataPath)) {
        try {
            existingMessages = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        } catch (e) {
            console.error('Error reading existing data', e);
        }
    }
    const existingHashes = new Map(existingMessages.filter(m => m.hash).map(m => [m.hash!, m]));

    console.log('Fetching channel...');
    const res = await fetch(CHANNEL_URL);
    const html = await res.text();

    // 1. Parse HTML (Fast)
    const root = parse(html);

    // 2. Select Message Wrappers
    // node-html-parser uses standard querySelectorAll
    const nodes = root.querySelectorAll('.tgme_widget_message_wrap').slice(-LIMIT);
    const messages: Message[] = [];

    for (const node of nodes) {
        // IDs are usually in data-post="channel/123"
        const msgNode = node.querySelector('.tgme_widget_message');
        const msgId = msgNode?.getAttribute('data-post')?.split('/')[1] || Date.now().toString();

        // Extract Text (innerHTML to preserve <br>, then clean)
        const textNode = node.querySelector('.tgme_widget_message_text');
        let text = '';
        if (textNode) {
            text = textNode.innerHTML
                .replace(/<br\s*\/?>/gi, '\n') // Turn breaks to newlines
                .replace(/<[^>]+>/g, '');      // Strip other HTML tags
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
        const contentHash = Bun.hash(JSON.stringify({ text, media: mediaToDownload })).toString();

        if (existingHashes.has(contentHash)) {
            console.log(`Skipping unchanged message ${msgId}`);
            messages.push(existingHashes.get(contentHash)!);
            continue;
        }

        // Download loop
        const savedFiles = [];
        for (let i = 0; i < mediaToDownload.length; i++) {
            const url = mediaToDownload[i]!;
            const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
            const filename = `${msgId}_${i}.${ext}`;
            
            await download(url, path.join(CACHE_DIR, filename));
            savedFiles.push(filename);
        }

        messages.push({ id: msgId, text, files: savedFiles, hash: contentHash });
    }

    // Save Cache
    fs.writeFileSync(path.join(CACHE_DIR, 'data.json'), JSON.stringify(messages, null, 2));
    console.log(`Success! Scraped ${messages.length} messages.`);
}

scrape();