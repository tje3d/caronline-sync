export {};

declare global {
    interface Message {
        id: string;
        text: string;
        files: string[];
        hash?: string;
        replyTo: string | null;
        isDeleted: boolean;
    }

    interface ProcessedMessage {
        baleIds: number[];
        hash: string;
        isDeleted: boolean;
        timestamp: number;
    }

    interface BaleResponse {
        ok: boolean;
        result?: any;
        error?: string;
        description?: string;
        error_code?: number;
    }
}
