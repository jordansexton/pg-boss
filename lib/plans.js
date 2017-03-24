"use strict";

module.exports = {
    create: create,
    insertVersion: insertVersion,
    getVersion: getVersion,
    versionTableExists: versionTableExists,
    fetchNextJob: fetchNextJob,
    expireJob: expireJob,
    completeJob: completeJob,
    cancelJob: cancelJob,
    insertJob: insertJob,
    archive: archive
};

function create(schema) {
    return [createSchema(schema), createVersionTable(schema), createJobStateEnum(schema), createJobTable(schema), createIndexSingletonOn(schema), createIndexSingletonKeyOn(schema), createIndexSingletonKey(schema)];
}

function createSchema(schema) {
    return "\n        CREATE SCHEMA IF NOT EXISTS " + schema + "\n    ";
}

function createVersionTable(schema) {
    return "\n        CREATE TABLE IF NOT EXISTS " + schema + ".version (\n            version text primary key\n        )";
}

function createJobStateEnum(schema) {
    // ENUM definition order is important
    // base type is numeric and first values are less than last values
    return "\n        CREATE TYPE " + schema + ".job_state AS ENUM (\n            'created',\n            'retry',\n            'active',\t\n            'complete',\n            'expired',\n            'cancelled'\n        )";
}

function createJobTable(schema) {
    return "\n        CREATE TABLE IF NOT EXISTS " + schema + ".job (\n            id uuid primary key not null,\n            name text not null,\n            data jsonb,\n            state " + schema + ".job_state not null,\n            retryLimit integer not null default(0),\n            retryCount integer not null default(0),\n            startIn interval,\n            startedOn timestamp without time zone,\n            singletonKey text,\n            singletonOn timestamp without time zone,\n            expireIn interval,\n            createdOn timestamp without time zone not null default now(),\n            completedOn timestamp without time zone\n        )";
}

function createIndexSingletonKey(schema) {
    // anything with singletonKey means "only 1 job can be queued or active at a time"
    return "\n        CREATE UNIQUE INDEX job_singletonKey ON " + schema + ".job (name, singletonKey) WHERE state < 'complete' AND singletonOn IS NULL\n    ";
}

function createIndexSingletonOn(schema) {
    // anything with singletonOn means "only 1 job within this time period, queued, active or completed"
    return "\n        CREATE UNIQUE INDEX job_singletonOn ON " + schema + ".job (name, singletonOn) WHERE state < 'expired' AND singletonKey IS NULL\n    ";
}

function createIndexSingletonKeyOn(schema) {
    // anything with both singletonOn and singletonKey means "only 1 job within this time period with this key, queued, active or completed"
    return "\n        CREATE UNIQUE INDEX job_singletonKeyOn ON " + schema + ".job (name, singletonOn, singletonKey) WHERE state < 'expired'\n    ";
}

function getVersion(schema) {
    return "\n        SELECT version from " + schema + ".version\n    ";
}

function versionTableExists(schema) {
    return "\n        SELECT to_regclass('" + schema + ".version') as name\n    ";
}

function insertVersion(schema) {
    return "INSERT INTO " + schema + ".version(version) VALUES ($1)";
}

function fetchNextJob(schema) {
    return "\n        WITH nextJob as (\n          SELECT id\n          FROM " + schema + ".job\n          WHERE state < 'active'\n            AND name = $1\n            AND (createdOn + startIn) < now()\n          ORDER BY createdOn, id\n          LIMIT 1\n          FOR UPDATE SKIP LOCKED\n        )\n        UPDATE " + schema + ".job SET\n          state = 'active',\n          startedOn = now(),\n          retryCount = CASE WHEN state = 'retry' THEN retryCount + 1 ELSE retryCount END\n        FROM nextJob\n        WHERE " + schema + ".job.id = nextJob.id\n        RETURNING " + schema + ".job.id, " + schema + ".job.data\n    ";
}

function expireJob(schema) {
    return "\n        UPDATE " + schema + ".job\n        SET state = CASE WHEN retryCount < retryLimit THEN 'retry'::" + schema + ".job_state ELSE 'expired'::" + schema + ".job_state END,        \n            completedOn = CASE WHEN retryCount < retryLimit THEN NULL ELSE now() END\n        WHERE state = 'active'\n            AND (startedOn + expireIn) < now()\n    ";
}

function completeJob(schema) {
    return "\n        UPDATE " + schema + ".job\n        SET completedOn = now(),\n            state = 'complete'\n        WHERE id = $1\n            AND state = 'active'\n    ";
}

function cancelJob(schema) {
    return "\n        UPDATE " + schema + ".job\n        SET completedOn = now(),\n            state = 'cancelled'\n        WHERE id = $1\n            AND state < 'complete'\n    ";
}

function insertJob(schema) {
    return "\n        INSERT INTO " + schema + ".job (id, name, state, retryLimit, startIn, expireIn, data, singletonKey, singletonOn)\n        VALUES (\n            $1, $2, 'created', $3, CAST($4 as interval), CAST($5 as interval), $6, $7,\n            CASE WHEN $8::integer IS NOT NULL THEN 'epoch'::timestamp + '1 second'::interval * ($8 * floor((date_part('epoch', now()) + $9) / $8)) ELSE NULL END\n        )\n        ON CONFLICT DO NOTHING\n    ";
}

function archive(schema) {
    return "\n        DELETE FROM " + schema + ".job WHERE completedOn + CAST($1 as interval) < now()\n    ";
}