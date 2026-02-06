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

  async getMe(): Promise<BaleResponse> {
    const url = `${BASE_URL}/getMe`;
    try {
      const response = await fetch(url);
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog('Error getting bot info', e);
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

  async sendMediaGroup(files: string[], caption?: string, replyToMessageId?: number): Promise<BaleResponse> {
    const url = `${BASE_URL}/sendMediaGroup`;
    const formData = new FormData();
    formData.append('chat_id', this.chatId);
    if (replyToMessageId) formData.append('reply_to_message_id', replyToMessageId.toString());

    const media = [];
     for (let i = 0; i < files.length; i++) {
         const filePath = files[i]!;
         const fileName = path.basename(filePath);
         const fileType = this.getFileType(filePath);
        const attachName = `file${i}`;
        
        try {
            const fileBuffer = await fs.readFile(filePath);
            formData.append(attachName, new Blob([fileBuffer]), fileName);
            
            media.push({
                type: fileType,
                media: `attach://${attachName}`,
                caption: i === 0 ? caption : undefined, // Only first item gets caption
                parse_mode: 'HTML'
            });
        } catch (e) {
            errorLog(`Error reading file ${fileName}`, e);
            throw e;
        }
    }
    
    formData.append('media', JSON.stringify(media));

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      return (await response.json()) as BaleResponse;
    } catch (e) {
      errorLog('Error sending media group', e);
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

  async testConnection() {
    log('🔍 Testing Bale Bot connection...');
    try {
      const res = await this.client.getMe();
      if (res.ok && res.result) {
        log(`✅ Bale Bot connected: @${res.result.username} (${res.result.first_name})`);
        return true;
      } else {
        errorLog('Failed to connect to Bale Bot', res.description || 'Unknown error');
        return false;
      }
    } catch (e) {
      errorLog('Failed to connect to Bale Bot', e);
      return false;
    }
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
      const raw = JSON.parse(data);
      const processed: Record<string, ProcessedMessage> = {};
      
      for (const [key, val] of Object.entries(raw)) {
          const v = val as any;
          if (v.baleId !== undefined && v.baleIds === undefined) {
              // Migration: Convert old format to new format
              processed[key] = {
                  ...v,
                  baleIds: [v.baleId]
              };
              delete (processed[key] as any).baleId;
          } else {
              processed[key] = v;
          }
      }
      
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
            if (parentProcessed && !parentProcessed.isDeleted && parentProcessed.baleIds.length > 0) {
              replyToBaleId = parentProcessed.baleIds[0];
            }
          }

          let baleMessageIds: number[] = [];

          // Send Media
          if (msg.files && msg.files.length > 0) {
            if (msg.files.length === 1) {
                // Single File
                const file = msg.files[0]!;
                const filePath = path.join(CACHE_DIR, file);
                try {
                    await fs.access(filePath);
                    const res = await this.client.sendFile(filePath, msg.text, replyToBaleId);
                    if (res.ok && res.result) {
                        baleMessageIds.push(res.result.message_id);
                    }
                    await this.deleteFile(filePath);
                } catch (e) {
                    errorLog(`Failed to send file ${file}`, e);
                    stats.errors++;
                }
            } else {
                // Multiple Files - Send as Media Group
                const filePaths: string[] = [];
                for (const file of msg.files) {
                    const fp = path.join(CACHE_DIR, file);
                    try {
                        await fs.access(fp);
                        filePaths.push(fp);
                    } catch {
                        log(`⚠️ Media file missing: ${file}, skipping`);
                    }
                }
                
                if (filePaths.length > 0) {
                    try {
                        const res = await this.client.sendMediaGroup(filePaths, msg.text, replyToBaleId);
                        if (res.ok && res.result && Array.isArray(res.result)) {
                             // Assuming result is array of messages
                             baleMessageIds = res.result.map((m: any) => m.message_id);
                        }
                        for (const fp of filePaths) await this.deleteFile(fp);
                    } catch (e) {
                         errorLog(`Failed to send media group`, e);
                         stats.errors++;
                    }
                }
            }
          } else if (msg.text) {
            // Send Text Only
            const res = await this.client.sendMessage(msg.text, replyToBaleId);
            if (res.ok && res.result) {
              baleMessageIds.push(res.result.message_id);
            } else {
                stats.errors++;
            }
          }

          if (baleMessageIds.length > 0) {
            this.processedPosts.set(msg.id, {
              baleIds: baleMessageIds,
              hash: msg.hash || '',
              isDeleted: false,
              timestamp: Date.now(),
            });
            changesMade = true;
            log(`✅ Synced message ${msg.id} -> Bale IDs ${baleMessageIds.join(', ')}`);
            stats.synced++;
          } else {
             if (stats.errors === 0 && !msg.isDeleted) {
                 // Skipped
             }
          }
        } else {
          // New but already deleted, just mark processed
          this.processedPosts.set(msg.id, {
            baleIds: [],
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
          for (const bid of processed.baleIds) {
            await this.client.deleteMessage(bid);
          }
          processed.isDeleted = true;
          processed.hash = msg.hash || '';
          changesMade = true;
          stats.deleted++;
        }
        // Check for Edits (Text only usually)
        else if (!msg.isDeleted && !processed.isDeleted && msg.hash !== processed.hash) {
           log(`✏️ Message ${msg.id} was edited`);
           if (processed.baleIds.length > 0) {
             const firstId = processed.baleIds[0]!;
             if (msg.text) {
               if (msg.files && msg.files.length > 0) {
                 await this.client.editMessageCaption(firstId, msg.text);
               } else {
                 await this.client.editMessage(firstId, msg.text);
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
