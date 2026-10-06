export const QUERY_PAGE_SIZE = 200;
export const QUERY_ID_BATCH_SIZE = 100;

/** Drain stable, ascending unique-key pages. A short server-capped page is not the end. */
export async function readAllByKey<Row>(
  readPage: (cursor: string | null) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  key: (row: Row) => string,
): Promise<Row[]> {
  const rows = new Map<string, Row>();
  let cursor: string | null = null;
  // Fail explicitly rather than silently truncate or loop forever on a broken source.
  for (let page = 0; page < 10_000; page++) {
    const result = await readPage(cursor);
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    if (!batch.length) return [...rows.values()];
    const next = key(batch[batch.length - 1]!);
    if (!next || (cursor !== null && next <= cursor))
      throw new Error("History pagination cursor did not advance");
    for (const row of batch) rows.set(key(row), row);
    cursor = next;
  }
  throw new Error("History pagination exceeded its safety limit");
}
