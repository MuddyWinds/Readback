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
