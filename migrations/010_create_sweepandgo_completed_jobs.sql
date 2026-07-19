CREATE TABLE IF NOT EXISTS sweepandgo_completed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'sweepandgo',
  external_job_id TEXT,
  job_fingerprint TEXT NOT NULL,
  service_date DATE NOT NULL,
  technician_key TEXT,
  technician_name TEXT,
  job_status TEXT NOT NULL DEFAULT 'unknown',
  job_type TEXT,
  service_category TEXT NOT NULL DEFAULT 'other',
  allocated_service_price NUMERIC(12, 2),
  recorded_duration_minutes NUMERIC(10, 2),
  stop_fingerprint TEXT NOT NULL,
  is_scoop BOOLEAN NOT NULL DEFAULT FALSE,
  is_spray BOOLEAN NOT NULL DEFAULT FALSE,
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  is_one_time BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'completed_jobs_report',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, job_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_completed_jobs_service_date
  ON sweepandgo_completed_jobs (service_date);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_completed_jobs_technician
  ON sweepandgo_completed_jobs (technician_key, service_date);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_completed_jobs_stop
  ON sweepandgo_completed_jobs (service_date, stop_fingerprint);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_completed_jobs_status_type
  ON sweepandgo_completed_jobs (job_status, job_type);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('010_create_sweepandgo_completed_jobs')
ON CONFLICT (version) DO NOTHING;
