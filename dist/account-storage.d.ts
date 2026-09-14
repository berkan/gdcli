import type { DriveAccount } from "./types.js";
export declare class AccountStorage {
    private accounts;
    constructor();
    private ensureConfigDir;
    private loadAccounts;
    private saveAccounts;
    addAccount(account: DriveAccount): void;
    getAccount(email: string): DriveAccount | undefined;
    getAllAccounts(): DriveAccount[];
    deleteAccount(email: string): boolean;
    hasAccount(email: string): boolean;
    setCredentials(clientId: string, clientSecret: string): void;
    getCredentials(): {
        clientId: string;
        clientSecret: string;
    } | null;
}
//# sourceMappingURL=account-storage.d.ts.map