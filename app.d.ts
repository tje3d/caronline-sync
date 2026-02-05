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
}
