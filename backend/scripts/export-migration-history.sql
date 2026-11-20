SELECT COALESCE(json_agg(row_to_json(history) ORDER BY history.migration_name), '[]'::json)
FROM (
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM public._prisma_migrations
) history;
