import { type drive_v3 } from "@googleapis/drive";
import type { DriveAccount } from "./types.js";
type DriveFile = drive_v3.Schema$File;
export interface FileListResult {
    files: DriveFile[];
    nextPageToken?: string;
}
export interface DownloadResult {
    success: boolean;
    path?: string;
    size?: number;
    error?: string;
}
export declare class DriveService {
    private accountStorage;
    private driveClients;
    /** Re-run the OAuth flow for an existing account and replace its refresh token. */
    reauthAccount(email: string, manual?: boolean): Promise<void>;
    addAccount(email: string, clientId: string, clientSecret: string, manual?: boolean): Promise<void>;
    deleteAccount(email: string): boolean;
    listAccounts(): DriveAccount[];
    setCredentials(clientId: string, clientSecret: string): void;
    getCredentials(): {
        clientId: string;
        clientSecret: string;
    } | null;
    /** Ensure the Google account that granted the token is the one we are about to store it under. */
    private verifyIdentity;
    private getDriveClient;
    listFiles(email: string, options?: {
        query?: string;
        folderId?: string;
        maxResults?: number;
        pageToken?: string;
        orderBy?: string;
    }): Promise<FileListResult>;
    getFile(email: string, fileId: string): Promise<DriveFile>;
    download(email: string, fileId: string, destPath?: string): Promise<DownloadResult>;
    private getExportMimeType;
    private getExportExtension;
    upload(email: string, localPath: string, options?: {
        name?: string;
        folderId?: string;
        mimeType?: string;
    }): Promise<DriveFile>;
    private guessMimeType;
    delete(email: string, fileId: string): Promise<void>;
    mkdir(email: string, name: string, parentId?: string): Promise<DriveFile>;
    move(email: string, fileId: string, newParentId: string): Promise<DriveFile>;
    rename(email: string, fileId: string, newName: string): Promise<DriveFile>;
    share(email: string, fileId: string, options?: {
        anyone?: boolean;
        email?: string;
        role?: "reader" | "writer";
    }): Promise<{
        link: string;
        permissionId: string;
    }>;
    unshare(email: string, fileId: string, permissionId: string): Promise<void>;
    listPermissions(email: string, fileId: string): Promise<Array<{
        id: string;
        type: string;
        role: string;
        email?: string;
    }>>;
    search(email: string, query: string, maxResults?: number, pageToken?: string): Promise<FileListResult>;
}
export {};
//# sourceMappingURL=drive-service.d.ts.map