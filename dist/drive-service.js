import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { drive as driveApi } from "@googleapis/drive";
import { OAuth2Client } from "google-auth-library";
import { AccountStorage } from "./account-storage.js";
import { DriveOAuthFlow } from "./drive-oauth-flow.js";
export class DriveService {
    accountStorage = new AccountStorage();
    driveClients = new Map();
    /** Re-run the OAuth flow for an existing account and replace its refresh token. */
    async reauthAccount(email, manual = false) {
        const account = this.accountStorage.getAccount(email);
        if (!account) {
            throw new Error(`Account '${email}' not found`);
        }
        const oauthFlow = new DriveOAuthFlow(account.oauth2.clientId, account.oauth2.clientSecret);
        const refreshToken = await oauthFlow.authorize(manual);
        await this.verifyIdentity(email, account.oauth2.clientId, account.oauth2.clientSecret, refreshToken);
        this.accountStorage.addAccount({
            email,
            oauth2: { clientId: account.oauth2.clientId, clientSecret: account.oauth2.clientSecret, refreshToken },
        });
        this.driveClients.delete(email);
    }
    async addAccount(email, clientId, clientSecret, manual = false) {
        if (this.accountStorage.hasAccount(email)) {
            throw new Error(`Account '${email}' already exists`);
        }
        const oauthFlow = new DriveOAuthFlow(clientId, clientSecret);
        const refreshToken = await oauthFlow.authorize(manual);
        await this.verifyIdentity(email, clientId, clientSecret, refreshToken);
        const account = {
            email,
            oauth2: { clientId, clientSecret, refreshToken },
        };
        this.accountStorage.addAccount(account);
    }
    deleteAccount(email) {
        this.driveClients.delete(email);
        return this.accountStorage.deleteAccount(email);
    }
    listAccounts() {
        return this.accountStorage.getAllAccounts();
    }
    setCredentials(clientId, clientSecret) {
        this.accountStorage.setCredentials(clientId, clientSecret);
    }
    getCredentials() {
        return this.accountStorage.getCredentials();
    }
    /** Ensure the Google account that granted the token is the one we are about to store it under. */
    async verifyIdentity(email, clientId, clientSecret, refreshToken) {
        const oauth2Client = new OAuth2Client(clientId, clientSecret, "http://localhost");
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const drive = driveApi({ version: "v3", auth: oauth2Client });
        const about = await drive.about.get({ fields: "user(emailAddress)" });
        const actual = about.data.user?.emailAddress || "";
        if (actual.toLowerCase() !== email.toLowerCase()) {
            throw new Error(`Authorized as '${actual}' but expected '${email}'. Token not saved.`);
        }
    }
    getDriveClient(email) {
        if (!this.driveClients.has(email)) {
            const account = this.accountStorage.getAccount(email);
            if (!account) {
                throw new Error(`Account '${email}' not found`);
            }
            const oauth2Client = new OAuth2Client(account.oauth2.clientId, account.oauth2.clientSecret, "http://localhost");
            oauth2Client.setCredentials({
                refresh_token: account.oauth2.refreshToken,
                access_token: account.oauth2.accessToken,
            });
            const drive = driveApi({ version: "v3", auth: oauth2Client });
            this.driveClients.set(email, drive);
        }
        return this.driveClients.get(email);
    }
    async listFiles(email, options = {}) {
        const drive = this.getDriveClient(email);
        let q = options.query || "";
        if (options.folderId) {
            const folderQuery = `'${options.folderId}' in parents`;
            q = q ? `${q} and ${folderQuery}` : folderQuery;
        }
        // Exclude trashed files by default
        if (!q.includes("trashed")) {
            q = q ? `${q} and trashed = false` : "trashed = false";
        }
        const response = await drive.files.list({
            q: q || undefined,
            pageSize: options.maxResults || 20,
            pageToken: options.pageToken,
            orderBy: options.orderBy || "modifiedTime desc",
            fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink)",
        });
        return {
            files: response.data.files || [],
            nextPageToken: response.data.nextPageToken || undefined,
        };
    }
    async getFile(email, fileId) {
        const drive = this.getDriveClient(email);
        const response = await drive.files.get({
            fileId,
            fields: "id, name, mimeType, size, modifiedTime, createdTime, parents, webViewLink, description, starred",
        });
        return response.data;
    }
    async download(email, fileId, destPath) {
        const drive = this.getDriveClient(email);
        // Get file metadata first
        const file = await this.getFile(email, fileId);
        if (!file.name) {
            return { success: false, error: "File has no name" };
        }
        // Determine destination path
        const downloadDir = path.join(os.homedir(), ".gdcli", "downloads");
        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }
        const filePath = destPath || path.join(downloadDir, `${fileId}_${file.name}`);
        // Check if it's a Google Workspace file (needs export)
        const isGoogleDoc = file.mimeType?.startsWith("application/vnd.google-apps.");
        try {
            if (isGoogleDoc) {
                // Export Google Workspace files
                const exportMimeType = this.getExportMimeType(file.mimeType);
                const response = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "stream" });
                const ext = this.getExportExtension(exportMimeType);
                const exportPath = filePath.replace(/\.[^.]+$/, "") + ext;
                const dest = fs.createWriteStream(exportPath);
                await new Promise((resolve, reject) => {
                    response.data.pipe(dest);
                    dest.on("finish", resolve);
                    dest.on("error", reject);
                });
                const stats = fs.statSync(exportPath);
                return { success: true, path: exportPath, size: stats.size };
            }
            // Download regular files
            const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
            const dest = fs.createWriteStream(filePath);
            await new Promise((resolve, reject) => {
                response.data.pipe(dest);
                dest.on("finish", resolve);
                dest.on("error", reject);
            });
            const stats = fs.statSync(filePath);
            return { success: true, path: filePath, size: stats.size };
        }
        catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    getExportMimeType(googleMimeType) {
        const exports = {
            "application/vnd.google-apps.document": "application/pdf",
            "application/vnd.google-apps.spreadsheet": "text/csv",
            "application/vnd.google-apps.presentation": "application/pdf",
            "application/vnd.google-apps.drawing": "image/png",
        };
        return exports[googleMimeType] || "application/pdf";
    }
    getExportExtension(mimeType) {
        const exts = {
            "application/pdf": ".pdf",
            "text/csv": ".csv",
            "image/png": ".png",
            "text/plain": ".txt",
        };
        return exts[mimeType] || ".pdf";
    }
    async upload(email, localPath, options = {}) {
        const drive = this.getDriveClient(email);
        const fileName = options.name || path.basename(localPath);
        const mimeType = options.mimeType || this.guessMimeType(localPath);
        const fileMetadata = {
            name: fileName,
            parents: options.folderId ? [options.folderId] : undefined,
        };
        const media = {
            mimeType,
            body: fs.createReadStream(localPath),
        };
        const response = await drive.files.create({
            requestBody: fileMetadata,
            media,
            fields: "id, name, mimeType, size, webViewLink",
        });
        return response.data;
    }
    guessMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            ".pdf": "application/pdf",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xls": "application/vnd.ms-excel",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".ppt": "application/vnd.ms-powerpoint",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".txt": "text/plain",
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".zip": "application/zip",
            ".csv": "text/csv",
            ".md": "text/markdown",
        };
        return mimeTypes[ext] || "application/octet-stream";
    }
    async delete(email, fileId) {
        const drive = this.getDriveClient(email);
        await drive.files.delete({ fileId });
    }
    async mkdir(email, name, parentId) {
        const drive = this.getDriveClient(email);
        const fileMetadata = {
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : undefined,
        };
        const response = await drive.files.create({
            requestBody: fileMetadata,
            fields: "id, name, mimeType, webViewLink",
        });
        return response.data;
    }
    async move(email, fileId, newParentId) {
        const drive = this.getDriveClient(email);
        // Get current parents
        const file = await this.getFile(email, fileId);
        const previousParents = file.parents?.join(",") || "";
        const response = await drive.files.update({
            fileId,
            addParents: newParentId,
            removeParents: previousParents,
            fields: "id, name, mimeType, parents, webViewLink",
        });
        return response.data;
    }
    async rename(email, fileId, newName) {
        const drive = this.getDriveClient(email);
        const response = await drive.files.update({
            fileId,
            requestBody: { name: newName },
            fields: "id, name, mimeType, webViewLink",
        });
        return response.data;
    }
    async share(email, fileId, options = {}) {
        const drive = this.getDriveClient(email);
        const role = options.role || "reader";
        let permission;
        if (options.anyone) {
            permission = { type: "anyone", role };
        }
        else if (options.email) {
            permission = { type: "user", role, emailAddress: options.email };
        }
        else {
            throw new Error("Must specify --anyone or --email");
        }
        const response = await drive.permissions.create({
            fileId,
            requestBody: permission,
            fields: "id",
        });
        // Get the shareable link
        const file = await drive.files.get({
            fileId,
            fields: "webViewLink",
        });
        return {
            link: file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
            permissionId: response.data.id || "",
        };
    }
    async unshare(email, fileId, permissionId) {
        const drive = this.getDriveClient(email);
        await drive.permissions.delete({ fileId, permissionId });
    }
    async listPermissions(email, fileId) {
        const drive = this.getDriveClient(email);
        const response = await drive.permissions.list({
            fileId,
            fields: "permissions(id, type, role, emailAddress)",
        });
        return (response.data.permissions || []).map((p) => ({
            id: p.id || "",
            type: p.type || "",
            role: p.role || "",
            email: p.emailAddress || undefined,
        }));
    }
    async search(email, query, maxResults = 20, pageToken) {
        const drive = this.getDriveClient(email);
        // Full-text search
        const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
        const response = await drive.files.list({
            q,
            pageSize: maxResults,
            pageToken,
            fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink)",
        });
        return {
            files: response.data.files || [],
            nextPageToken: response.data.nextPageToken || undefined,
        };
    }
}
//# sourceMappingURL=drive-service.js.map