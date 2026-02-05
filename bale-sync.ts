import fs from 'fs/promises';
import path from 'path';

// --- Configuration ---

const BALE_BOT_TOKEN = process.env.BALE_BOT_TOKEN;
const BALE_CHAT_ID = process.env.BALE_CHAT_ID;
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), 'cache');
const DATA_FILE = path.join(CACHE_DIR, 'data.json');
const PROCESSED_FILE = path.join(CACHE_DIR, 'bale_processed.json');
const BASE_URL = `https://tapi.bale.ai/bot${BALE_BOT_TOKEN}`;

// --- Logger ---
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function errorLog(message: string, error?: any) {
  console.error(`[${new Date().toISOString()}] ❌ ${message}`, error || '');
}

// --- Bale API Client ---

class BaleClient {
  constructor(private token: string, private chatId: string) {
    if (!token || !chatId) {
      throw new Error('BALE_BOT_TOKEN and BALE_CHAT_ID must be set');
    }
  }

  async sendMessage(text: string, replyToMessageId?: number): Promise<BaleResponse> {
    const url = `${BASE_URL}/sendMessage`;
    const payload: any = {
      chat_id: this.chatId,
      text: text,
      parse_mode: 'HTML',
    };
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog('Error sending message', e);
      throw e;
    }
  }

  async sendFile(filePath: string, caption?: string, replyToMessageId?: number): Promise<BaleResponse> {
    const fileName = path.basename(filePath);
    const fileType = this.getFileType(filePath);
    let url: string;
    let fieldName: string;

    switch (fileType) {
      case 'photo':
        url = `${BASE_URL}/sendPhoto`;
        fieldName = 'photo';
        break;
      case 'video':
        url = `${BASE_URL}/sendVideo`;
        fieldName = 'video';
        break;
      case 'audio':
        url = `${BASE_URL}/sendAudio`;
        fieldName = 'audio';
        break;
      default:
        url = `${BASE_URL}/sendDocument`;
        fieldName = 'document';
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const formData = new FormData();
      formData.append('chat_id', this.chatId);
      formData.append(fieldName, new Blob([fileBuffer]), fileName);
      if (caption) formData.append('caption', caption);
      if (replyToMessageId) formData.append('reply_to_message_id', replyToMessageId.toString());

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog(`Error sending file ${fileName}`, e);
      throw e;
    }
  }

  async editMessage(messageId: number, text: string): Promise<BaleResponse> {
    const url = `${BASE_URL}/editMessageText`;
    const payload = {
      chat_id: this.chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog(`Error editing message ${messageId}`, e);
      throw e;
    }
  }

  async editMessageCaption(messageId: number, caption: string): Promise<BaleResponse> {
    const url = `${BASE_URL}/editMessageCaption`;
    const payload = {
      chat_id: this.chatId,
      message_id: messageId,
      caption: caption,
      parse_mode: 'HTML',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog(`Error editing message caption ${messageId}`, e);
      throw e;
    }
  }

  async deleteMessage(messageId: number): Promise<BaleResponse> {
    const url = `${BASE_URL}/deleteMessage`;
    const payload = {
      chat_id: this.chatId,
      message_id: messageId,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog(`Error deleting message ${messageId}`, e);
      throw e;
    }
  }

  private getFileType(filePath: string): 'photo' | 'video' | 'audio' | 'document' {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) return 'photo';
    if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)) return 'video';
    if (['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'].includes(ext)) return 'audio';
    return 'document';
  }
}

// --- Sync Service ---

class BaleSyncService {
  private processedPosts: Map<string, ProcessedMessage> = new Map();
  private client: BaleClient;

  constructor() {
    if (!BALE_BOT_TOKEN || !BALE_CHAT_ID) {
      console.error('Missing environment variables: BALE_BOT_TOKEN or BALE_CHAT_ID');
      process.exit(1);
    }
    this.client = new BaleClient(BALE_BOT_TOKEN, BALE_CHAT_ID);
  }

  async start() {
    log('🚀 Starting Bale Sync Service...');
    await this.loadProcessedPosts();

    // Start polling loop
    while (true) {
      try {
        await this.sync();
      } catch (error) {
        errorLog('Error during sync cycle', error);
      }
      // Wait 5 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async loadProcessedPosts() {
    try {
      const data = await fs.readFile(PROCESSED_FILE, 'utf-8');
      const processed = JSON.parse(data) as Record<string, ProcessedMessage>;
      this.processedPosts = new Map(Object.entries(processed));
      log(`📋 Loaded ${this.processedPosts.size} processed posts`);
    } catch (error) {
      log('📋 No processed posts file found, starting fresh');
    }
  }

  private async saveProcessedPosts() {
    try {
      const processedObj = Object.fromEntries(this.processedPosts);
      await fs.writeFile(PROCESSED_FILE, JSON.stringify(processedObj, null, 2));
    } catch (error) {
      errorLog('Error saving processed posts', error);
    }
  }

  public async syncOnce() {
    await this.loadProcessedPosts();
    try {
      await this.sync();
    } catch (error) {
      errorLog('Error during sync cycle', error);
    }
  }

  private async sync() {
    // 1. Load data.json
    let messages: Message[] = [];
    try {
      const data = await fs.readFile(DATA_FILE, 'utf-8');
      messages = JSON.parse(data);
    } catch (error) {
      // If file doesn't exist yet, just return
      return;
    }

    // 2. Sort messages by ID to ensure order (assuming ID is sortable/incremental)
    // Note: ID in data.json is string, assuming it's numeric string from Telegram
    messages.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    let changesMade = false;
    const stats = {
      synced: 0,
      edited: 0,
      deleted: 0,
      skipped: 0,
      errors: 0
    };

    for (const msg of messages) {
      const processed = this.processedPosts.get(msg.id);

      if (!processed) {
        // --- NEW MESSAGE ---
        if (!msg.isDeleted) {
          log(`🆕 New message detected: ${msg.id}`);
          
          // Determine reply_to
          let replyToBaleId: number | undefined;
          if (msg.replyTo) {
            const parentProcessed = this.processedPosts.get(msg.replyTo);
            if (parentProcessed && !parentProcessed.isDeleted) {
              replyToBaleId = parentProcessed.baleId;
            }
          }

          let baleMessageId: number | undefined;

          // Send Media
          if (msg.files && msg.files.length > 0) {
            // Send each file
            for (let i = 0; i < msg.files.length; i++) {
              const file = msg.files[i]!;
              const filePath = path.join(CACHE_DIR, file);
              const textToSend: string | undefined = (i === 0) ? msg.text : undefined;
              
              try {
                // Check if file exists before sending
                try {
                  await fs.access(filePath);
                } catch {
                   log(`⚠️ Media file missing: ${file}, skipping`);
                   continue;
                }

                const res = await this.client.sendFile(filePath, textToSend, replyToBaleId);
                if (res.ok && res.result) {
                  // Track the first message ID as the main ID
                  if (i === 0) baleMessageId = res.result.message_id;
                }
                
                // DELETE FILE after successful send
                await this.deleteFile(filePath);
                
              } catch (e) {
                errorLog(`Failed to send file ${file}`, e);
                stats.errors++;
              }
            }
          } else if (msg.text) {
            // Send Text Only
            const res = await this.client.sendMessage(msg.text, replyToBaleId);
            if (res.ok && res.result) {
              baleMessageId = res.result.message_id;
            } else {
                stats.errors++;
            }
          }

          if (baleMessageId) {
            this.processedPosts.set(msg.id, {
              baleId: baleMessageId,
              hash: msg.hash || '',
              isDeleted: false,
              timestamp: Date.now(),
            });
            changesMade = true;
            log(`✅ Synced message ${msg.id} -> Bale ID ${baleMessageId}`);
            stats.synced++;
          } else {
             // If we didn't get a baleMessageId and didn't log an error (e.g. empty message?), count as error or skipped?
             // If errors were already counted above, we don't want to double count or miss count.
             // If errors > 0, we already counted.
             // If it was just empty, maybe skipped.
             if (stats.errors === 0 && !msg.isDeleted) {
                 // Maybe it was skipped due to missing files but not counted as error?
                 // Let's just leave it.
             }
          }
        } else {
          // New but already deleted, just mark processed
          this.processedPosts.set(msg.id, {
            baleId: -1, // No real ID
            hash: msg.hash || '',
            isDeleted: true,
            timestamp: Date.now(),
          });
          changesMade = true;
          stats.skipped++;
        }

      } else {
        // --- EXISTING MESSAGE ---
        
        // Check for Deletion
        if (msg.isDeleted && !processed.isDeleted) {
          log(`🗑️ Message ${msg.id} was deleted`);
          if (processed.baleId > 0) {
            await this.client.deleteMessage(processed.baleId);
          }
          processed.isDeleted = true;
          processed.hash = msg.hash || '';
          changesMade = true;
          stats.deleted++;
        }
        // Check for Edits (Text only usually)
        else if (!msg.isDeleted && !processed.isDeleted && msg.hash !== processed.hash) {
           log(`✏️ Message ${msg.id} was edited`);
           if (processed.baleId > 0) {
             if (msg.text) {
               if (msg.files && msg.files.length > 0) {
                 await this.client.editMessageCaption(processed.baleId, msg.text);
               } else {
                 await this.client.editMessage(processed.baleId, msg.text);
               }
             }
           }
           processed.hash = msg.hash || '';
           changesMade = true;
           stats.edited++;
        } else {
            stats.skipped++;
        }
      }
    }

    log(`Sync stats: ${stats.synced} synced, ${stats.edited} edited, ${stats.deleted} deleted, ${stats.skipped} skipped, ${stats.errors} errors`);

    if (changesMade) {
      await this.saveProcessedPosts();
    }
  }

  private async deleteFile(filePath: string) {
    try {
      await fs.unlink(filePath);
      log(`🗑️ Deleted local file: ${path.basename(filePath)}`);
    } catch (e) {
      // Ignore if file not found
    }
  }
}

export { BaleSyncService };

// Start the service only if run directly
if (import.meta.main) {
  const service = new BaleSyncService();
  service.start().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
