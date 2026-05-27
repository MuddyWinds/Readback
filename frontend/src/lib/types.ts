export interface FeedStatus {
  airport_code: string;
  stage: string;
  detail?: string | null;
  updated_at: string;
}

export interface PipelineStatus {
  last_audio_at: string | null;
  last_transcript_at: string | null;
  last_batch_started_at: string | null;
  last_batch_completed_at: string | null;
  next_batch_at: string | null;
  last_error: string | null;
  last_gemini_error: string | null;
  last_persisted_count: number;
  queued_transcripts: number;
  batch_interval_seconds: number;
  feed_status: Record<string, FeedStatus>;
}

export interface SpeakerSegment { role: "ATC" | "PILOT" | "UNKNOWN"; text: string; }

export interface Enrichment {
  speaker_segments:     SpeakerSegment[];
  atc_instruction:      string | null;
  pilot_readback:       string | null;
  readback_correct:     boolean | null;
  readback_discrepancy: string | null;
  callsign_detected:    string | null;
  callsign_clarity:     number; // 0-100
}

export type ObservationKind = "phraseology_note" | "situational_event";

export interface Observation {
  kind: ObservationKind;
  note_type: string;
  hfacs_level: string;
  significance: "low" | "medium" | "high" | "critical";
  description: string;
  safety_pathway?: string | null;
  relevant_regulation?: string | null;
  transcript_excerpt?: string | null;
}

export interface AnalysisResult {
  id?: number;
  timestamp: string;
  airport_code: string;
  transcript: string;
  assessable?: boolean;
  assessable_confidence?: number;
  is_standard: boolean;
  observations: Observation[];
  summary: string;
  confidence_score: number;
  enrichment?: Enrichment | null;
  status?: string;
  reviewer_notes?: string;
}

export type Severity = "standard" | "low" | "medium" | "high" | "critical" | "unassessable";
export type Filter = "all" | "standard" | "low" | "medium" | "high" | "critical" | "unassessable";
export type GroupBy = "none" | "airport";
