import type { CloudSyncProfileInput } from "../../domain/cloud-sync";
import type { AppStore } from "../types";

type SyncSliceContext = {
  saveProfile: (profile: CloudSyncProfileInput) => Promise<void>;
  testConnection: (profile: CloudSyncProfileInput) => Promise<Awaited<ReturnType<AppStore["testCloudSync"]>>>;
  run: (profile?: CloudSyncProfileInput) => Promise<Awaited<ReturnType<AppStore["runCloudSync"]>>>;
};

export function createSyncSlice({ saveProfile, testConnection, run }: SyncSliceContext) {
  return {
    saveCloudSyncProfile: saveProfile,
    testCloudSync: testConnection,
    runCloudSync: run,
  };
}
