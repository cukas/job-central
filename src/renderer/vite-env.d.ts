/// <reference types="vite/client" />

import type { JobCentralApi } from "../shared/types";

declare global {
  interface Window {
    jobCentral: JobCentralApi;
  }
}
