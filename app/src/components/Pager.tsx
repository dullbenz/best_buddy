import { useEffect, useMemo, useState } from "react";

/**
 * Paging for every list on the site.
 *
 * The holder snapshot is thousands of rows in production. Rendering all of
 * them was fine with a ten-row fixture and would be a wall of DOM on the real
 * list, so every table pages — the two published lists and the stream history
 * alike, because they will all outgrow a screen and none of them should behave
 * differently from the others.
 *
 * Filtering resets to page one. Staying on page 40 of a search that returned
 * three rows shows an empty table and reads as "no results", which is the
 * wrong answer told convincingly.
 */
export function usePaged<T>(items: T[], perPage: number) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const reset = () => setPage(0);

  const slice = useMemo(
    () => items.slice(page * perPage, page * perPage + perPage),
    [items, page, perPage]
  );

  return {
    slice,
    page,
    pageCount,
    setPage,
    reset,
    from: items.length === 0 ? 0 : page * perPage + 1,
    to: Math.min(items.length, (page + 1) * perPage),
    total: items.length,
  };
}

export function Pager({
  page,
  pageCount,
  from,
  to,
  total,
  unit,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  /** What is being counted, e.g. "wallets" or "transactions". */
  unit: string;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;

  return (
    <div className="pager">
      <span className="pager-count">
        {from}–{to} of {total} {unit}
      </span>
      {pageCount > 1 && (
        <div className="pager-buttons">
          <button
            type="button"
            className="pager-btn"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            ←
          </button>
          <span className="pager-page">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="pager-btn"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
