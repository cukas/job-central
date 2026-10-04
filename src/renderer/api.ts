import type { JobCentralApi } from "../shared/types";

export function jobCentral(): JobCentralApi {
  const api = (window as unknown as { jobCentral?: JobCentralApi }).jobCentral;
  if (!api) throw new Error("Job Central API is not available. Check the Electron preload bridge.");
  return api;
}
