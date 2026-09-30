export type SourceKind = 'ats' | 'rss' | 'api' | 'xhr' | 'html';

export type ApplicationStatus = 'saved' | 'applied' | 'interview' | 'offer' | 'rejected';

export type ProfileFactStatus = 'pending' | 'approved' | 'rejected';

export interface CanonicalJob {
  id: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string;
  descriptionMd: string;
  techStack: string[];
  salaryMin?: number;
  salaryMax?: number;
  remoteFriendly: boolean;
  language?: string;
  sourceKind: SourceKind;
  sourcePriority: number;
  postedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SourceRegistryEntry {
  id: string;
  kind: SourceKind;
  vendor: string;
  company: string;
  careersUrl: string;
  slug: string;
  enabled: boolean;
  confidence: number;
}

export interface JobMatch {
  jobId: string;
  score: number;
  reasoningMd?: string;
  status: ApplicationStatus;
}

export interface JobListResponse {
  jobs: CanonicalJob[];
  total: number;
}

export interface WorkspaceFolderConfig {
  rootPath: string;
  enabled: boolean;
}

export interface ProfileFact {
  id: string;
  category: string;
  assertion: string;
  sourceSegment: string;
  status: ProfileFactStatus;
  createdAt: string;
}

export interface CvProject {
  id: string;
  title: string;
  organisation: string;
  role: string;
  startDate: string;
  endDate: string;
  summary: string;
  highlights: string[];
  techTags: string[];
  sourceDocId: string;
  sourceQuote: string;
  included: boolean;
  order: number;
}

export interface RoleTailoring {
  id: string;
  targetRole: string;
  includedProjectIds: string[];
  updatedAt: string;
}
