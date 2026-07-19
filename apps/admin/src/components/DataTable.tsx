import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnPinningState,
} from '@tanstack/react-table';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ArrowLeftToLine, ArrowRightToLine, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

// Generic, headless-styled admin table used across the Organization
// Directory, WFH Ledger, and QR history/logs — one implementation instead
// of four hand-rolled tables. Styled with the shared --color-nexus-*
// design tokens (see index.css) so it matches every page that uses it.
//
// Client-side sort/filter/paginate over whatever `data` is passed in — the
// backend still caps how much comes down (same convention QR history/logs
// already used before this component existed). Fine for the tens-to-low-
// hundreds of rows a tenant realistically has; if a tenant ever reaches
// thousands of rows this would need to move to server-side pagination
// instead — a known, deliberate tradeoff, not an oversight.
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  searchPlaceholder?: string;
  /** Column id to run the search box against (e.g. combined name+email accessor). Defaults to global (all columns). */
  globalFilterColumnIds?: string[];
  /** Column id + distinct options for a dropdown filter (e.g. role). */
  filterColumn?: { id: string; label: string; options: string[] };
  initialPinning?: ColumnPinningState;
  pageSize?: number;
  emptyMessage?: string;
  onAddNew?: () => void;
  addNewLabel?: string;
  /** When provided, rows become clickable and expand to show this content
      inline below the row (e.g. a full leave-request reason). Return null
      for a row to make it non-expandable. */
  renderRowDetail?: (row: T) => ReactNode;
}

export default function DataTable<T>({
  data,
  columns,
  searchPlaceholder = 'Search...',
  globalFilterColumnIds,
  filterColumn,
  initialPinning,
  pageSize = 10,
  emptyMessage = 'No records found.',
  onAddNew,
  addNewLabel = 'Add New',
  renderRowDetail,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(initialPinning || {});
  const [roleFilterValue, setRoleFilterValue] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const globalFilterFn = useMemo(() => {
    return (row: any, _columnId: string, filterValue: string) => {
      const needle = filterValue.trim().toLowerCase();
      if (!needle) return true;
      const idsToCheck = globalFilterColumnIds || columns.map(c => (c as any).id || (c as any).accessorKey).filter(Boolean);
      return idsToCheck.some((id: string) => {
        const val = row.getValue(id);
        return val != null && String(val).toLowerCase().includes(needle);
      });
    };
  }, [globalFilterColumnIds, columns]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnPinning },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnPinningChange: setColumnPinning,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  const cyclePin = (columnId: string) => {
    const current = columnPinning.left?.includes(columnId) ? 'left' : columnPinning.right?.includes(columnId) ? 'right' : false;
    const next = current === false ? 'left' : current === 'left' ? 'right' : false;
    table.getColumn(columnId)?.pin(next as any);
  };

  return (
    <div>
      {/* Toolbar: search, optional role filter, optional add-new */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-[var(--color-nexus-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-2 text-[14px] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-ink)]"
          />
        </div>
        {filterColumn && (
          <select
            value={roleFilterValue}
            onChange={e => {
              setRoleFilterValue(e.target.value);
              table.getColumn(filterColumn.id)?.setFilterValue(e.target.value || undefined);
            }}
            className="text-[14px] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] px-3 py-2 text-[var(--color-nexus-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)]"
          >
            <option value="">All {filterColumn.label}</option>
            {filterColumn.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {onAddNew && (
          <button
            onClick={onAddNew}
            className="ml-auto flex items-center gap-1.5 bg-[var(--color-nexus-primary)] hover:opacity-90 text-white text-[12px] font-semibold uppercase tracking-wider px-4 py-2 rounded-[var(--radius-nexus-control)] transition-opacity"
          >
            <Plus size={14} /> {addNewLabel}
          </button>
        )}
      </div>

      <div className="overflow-x-auto nexus-card !shadow-none">
        <table className="w-full text-left border-collapse">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="border-b border-[var(--color-nexus-border)] text-[12px] text-[var(--color-nexus-muted)] font-semibold uppercase tracking-wider bg-[var(--color-nexus-surface-alt)]">
                {headerGroup.headers.map(header => {
                  const pinned = header.column.getIsPinned();
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`py-3 px-4 select-none ${pinned ? 'sticky z-10 bg-[var(--color-nexus-surface-alt)]' : ''}`}
                      style={pinned ? { [pinned === 'left' ? 'left' : 'right']: 0 } : undefined}
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!canSort}
                          onClick={header.column.getToggleSortingHandler()}
                          className={`flex items-center gap-1 ${canSort ? 'hover:text-[var(--color-nexus-ink)] cursor-pointer' : ''}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sortDir === 'asc' ? <ArrowUp size={11} /> : sortDir === 'desc' ? <ArrowDown size={11} /> : <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </button>
                        {header.column.columnDef.enablePinning !== false && (
                          <button
                            type="button"
                            title={pinned ? 'Unpin column' : 'Pin column'}
                            onClick={() => cyclePin(header.column.id)}
                            className={`p-0.5 rounded transition-colors ${pinned ? 'text-[var(--color-nexus-ink)] bg-[var(--color-nexus-primary-fixed)]' : 'text-[var(--color-nexus-border)] hover:text-[var(--color-nexus-muted)]'}`}
                          >
                            {pinned === 'right' ? <ArrowRightToLine size={11} /> : <ArrowLeftToLine size={11} />}
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-10 text-center text-[13px] text-[var(--color-nexus-muted)]">{emptyMessage}</td>
              </tr>
            ) : rows.map(row => {
              const isExpanded = expandedRowId === row.id;
              const detail = renderRowDetail ? renderRowDetail(row.original) : null;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={detail ? () => setExpandedRowId(isExpanded ? null : row.id) : undefined}
                    className={`border-b border-[var(--color-nexus-border)] text-[14px] font-medium [font-variant-numeric:tabular-nums] hover:bg-[var(--color-nexus-surface-alt)] transition-colors ${detail ? 'cursor-pointer' : ''}`}
                  >
                    {row.getVisibleCells().map(cell => {
                      const pinned = cell.column.getIsPinned();
                      return (
                        <td
                          key={cell.id}
                          className={`py-3.5 px-4 ${pinned ? 'sticky z-10 bg-[var(--color-nexus-surface)]' : ''}`}
                          style={pinned ? { [pinned === 'left' ? 'left' : 'right']: 0 } : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && detail && (
                    <tr className="border-b border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface-alt)]">
                      <td colSpan={columns.length} className="px-4 py-3 text-[13px] text-[var(--color-nexus-ink)]">
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between mt-4 text-[12px] text-[var(--color-nexus-muted)]">
          <span>
            Page {pageIndex + 1} of {Math.max(pageCount, 1)} &middot; {table.getFilteredRowModel().rows.length} record{table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1.5 rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-border)] disabled:opacity-30 hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1.5 rounded-[var(--radius-nexus-control)] border border-[var(--color-nexus-border)] disabled:opacity-30 hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
