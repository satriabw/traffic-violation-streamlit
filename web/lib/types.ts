export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
export type FileType = 'calibration' | 'configuration' | 'video' | 'evidence_frame';
type Timestamps = {
  created_at: string;
  updated_at: string;
};
export type Source = Timestamps & {
  id: string;
  site_id: string;
  version: number;
  kind: 'video' | 'stream';
  status: string;
  stream_url?: string | null;
  file_id?: string | null;
  recorded_at?: string | null;
  metadata?: {
    total_frames?: number | null;
    fps?: number | null;
    nominal_fps?: number | null;
    duration_seconds?: number | null;
    resolution?: {
      width: number;
      height: number;
    } | null;
  } | null;
};
export type Site = Timestamps & {
  id: string;
  name: string;
  source?: Source | null;
};
export type FileRow = Timestamps & {
  id: string;
  name: string;
  url: string;
  type: FileType;
  status: string;
  content_type?: string | null;
  size_bytes?: number | null;
  download_url?: string | null;
  upload_url?: string;
  upload_expires_in?: number;
};
export type Doc = Timestamps & {
  id: string;
  site_id: string;
  file_id: string;
  version: number;
};
export type Run = Timestamps & {
  id: string;
  site_id: string;
  source_id?: string | null;
  calibration_id?: string | null;
  configuration_id?: string | null;
  types: string[];
  frame_start?: number | null;
  frame_end?: number | null;
  status: string;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};
export type Session = {
  id: string;
  site_id: string;
  source_id: string;
  status: string;
  types: string[];
  calibration_id?: string | null;
  configuration_id?: string | null;
  error?: string | null;
  created_at: string;
};
export type ViolationSummary = Timestamps & {
  id: string;
  site_id: string;
  source_id?: string | null;
  source_name?: string | null;
  source_version?: number | null;
  run_id: string;
  frame_index?: number | null;
  calibration_id?: string | null;
  calibration_version?: number | null;
  configuration_id?: string | null;
  configuration_version?: number | null;
  type: string;
  explanation_status: string;
  detected_at: string;
  evidence_status?: string | null;
  thumbnail_url?: string | null;
  clip_url?: string | null;
  thumbnail_key?: string | null;
  clip_key?: string | null;
  key_frame_key?: string | null;
};
export type Track = {
  track_id: number;
  trajectory: ([
    number,
    number
  ] | null)[];
  speed: (number | null)[];
  frame_idxs: number[];
  bboxes: [
    number,
    number,
    number,
    number
  ][];
};
export type Violation = ViolationSummary & {
  involved_track_ids?: number[];
  metadata?: {
    vehicles: Track[];
    pedestrians: Track[];
    cyclists?: Track[];
    violator_track_id?: number | null;
    frames: string[];
    ground_from_pixel?: number[][] | null;
    reasons: [
      string,
      unknown
    ][];
    lights: [
      number,
      Record<string, string>
    ][];
  } | null;
};
export type ReviewSource = {
  tool: string;
  turn: number;
};
export type BasisPoint = {
  point: string;
  tracking_facts: string[];
  picture: boolean;
  source: ReviewSource | null;
  quote: string | null;
};
export type Recommendation = {
  text: string;
  justification: BasisPoint[];
};
export type ReviewDoc = {
  flag_check: {
    status: 'on_foot' | 'riding' | 'stands' | 'does_not_stand' | 'unclear';
    seen: string;
    tracking_facts: string[];
    picture: boolean;
  };
  clerk_recommendation: Recommendation;
  summary: string;
  driver_recommendations: Recommendation[];
  site_recommendations: Recommendation[];
  legal_candidates: {
    rule: string;
    article: string | null;
    source_as_cited: string;
    source: ReviewSource | null;
  }[];
  still_unsure: string[];
  open_questions_final: {
    id: number;
    status: 'open' | 'settled' | 'unanswerable';
  }[];
};
export type ReviewState = {
  violation_id: string;
  status: 'running' | 'completed' | 'failed';
  review?: ReviewDoc | null;
  error?: string | null;
};
export type ChatSummary = Timestamps & {
  id: string;
  subject_kind: string;
  subject_id: string;
  title: string | null;
  status: 'idle' | 'answering' | 'failed';
  questions: number;
};
export type ChatTurn = {
  question: number;
  text: string;
  reply: string | null;
  error: string | null;
  first_event: number;
  last_event: number;
};
export type Chat = ChatSummary & {
  turns: ChatTurn[];
};
// Event payloads vary by backend event type and are consumed progressively.
export type StreamEvent = {
  type: string;
  sequence?: number;
  elapsed_seconds?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
};
