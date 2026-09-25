-- Cross-workspace file recovery is performed only through guarded, atomic functions.
BEGIN;

CREATE OR REPLACE FUNCTION app.claim_file_upload_recovery_jobs(p_worker text, p_limit integer DEFAULT 10)
RETURNS TABLE (
    id uuid, workspace_id uuid, file_id uuid, upload_session_id uuid,
    lease_version bigint, attempt_count integer, appwrite_user_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
    WITH candidates AS (
        SELECT j.id
        FROM app.file_jobs j
        WHERE j.job_kind = 'persist' AND j.upload_session_id IS NOT NULL
          AND ((j.status IN ('queued','retry_wait') AND j.next_run_at <= now())
            OR (j.status = 'running' AND j.lease_until <= clock_timestamp()))
        ORDER BY j.next_run_at, j.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit, 10)))
    ), claimed AS (
        UPDATE app.file_jobs j
        SET status = 'running', attempt_count = j.attempt_count + 1,
            lease_version = j.lease_version + 1,
            lease_owner = left(btrim(p_worker), 200),
            lease_until = clock_timestamp() + interval '2 minutes'
        FROM candidates c
        WHERE j.id = c.id AND length(btrim(p_worker)) > 0
        RETURNING j.id, j.workspace_id, j.file_id, j.upload_session_id, j.lease_version, j.attempt_count
    )
    SELECT c.id, c.workspace_id, c.file_id, c.upload_session_id, c.lease_version,
           c.attempt_count, u.appwrite_user_id
    FROM claimed c
    JOIN app.workspaces w ON w.id = c.workspace_id
    JOIN app.user_accounts u ON u.id = w.owner_user_id
    WHERE u.status = 'active' AND w.status = 'active';
$$;

CREATE OR REPLACE FUNCTION app.finish_file_job(p_job uuid, p_worker text, p_lease_version bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
    PERFORM set_config('app.file_job_lease_owner', p_worker, true);
    PERFORM set_config('app.file_job_lease_version', p_lease_version::text, true);
    UPDATE app.file_jobs
    SET status = 'succeeded', lease_owner = NULL, lease_until = NULL, last_error_code = NULL
    WHERE id = p_job AND status = 'running' AND lease_owner = p_worker
      AND lease_version = p_lease_version AND lease_until > clock_timestamp();
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION app.cancel_file_job(p_job uuid, p_worker text, p_lease_version bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
    PERFORM set_config('app.file_job_lease_owner', p_worker, true);
    PERFORM set_config('app.file_job_lease_version', p_lease_version::text, true);
    UPDATE app.file_jobs
    SET status = 'cancelled', lease_owner = NULL, lease_until = NULL
    WHERE id = p_job AND status = 'running' AND lease_owner = p_worker
      AND lease_version = p_lease_version AND lease_until > clock_timestamp();
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION app.retry_file_job(
    p_job uuid, p_worker text, p_lease_version bigint, p_error_code text, p_max_attempts integer DEFAULT 8
)
RETURNS TABLE (status text, delay_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
    v_attempt integer;
    v_status text;
    v_delay integer;
BEGIN
    SELECT j.attempt_count INTO v_attempt
    FROM app.file_jobs j
    WHERE j.id = p_job AND j.status = 'running' AND j.lease_owner = p_worker
      AND j.lease_version = p_lease_version AND j.lease_until > clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '文件恢复作业租约已失效' USING ERRCODE = '40001';
    END IF;

    v_status := CASE WHEN v_attempt >= GREATEST(1, COALESCE(p_max_attempts, 8)) THEN 'needs_attention' ELSE 'retry_wait' END;
    v_delay := LEAST(3600, 15 * (2 ^ LEAST(8, GREATEST(0, v_attempt - 1)))::integer);
    PERFORM set_config('app.file_job_lease_owner', p_worker, true);
    PERFORM set_config('app.file_job_lease_version', p_lease_version::text, true);
    UPDATE app.file_jobs
    SET status = v_status, lease_owner = NULL, lease_until = NULL,
        next_run_at = now() + make_interval(secs => v_delay),
        last_error_code = left(regexp_replace(COALESCE(p_error_code, 'persist_failed'), '[^A-Za-z0-9_.-]', '_', 'g'), 120)
    WHERE id = p_job;
    RETURN QUERY SELECT v_status, v_delay;
END;
$$;

REVOKE ALL ON FUNCTION app.claim_file_upload_recovery_jobs(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finish_file_job(uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.cancel_file_job(uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.retry_file_job(uuid, text, bigint, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_file_upload_recovery_jobs(text, integer),
    app.finish_file_job(uuid, text, bigint), app.cancel_file_job(uuid, text, bigint),
    app.retry_file_job(uuid, text, bigint, text, integer)
TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0064_file_job_worker_functions', 'file-job-worker-functions-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
