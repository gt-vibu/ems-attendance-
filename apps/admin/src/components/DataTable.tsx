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
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ArrowLeftToLine, ArrowRightToLine, Plus, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

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
  /** Optional: which column keys to show as the card title on mobile. Defaults to first column. */
  mobileCardTitleKey?: string;
  /** Optional: which column keys to show as a status badge on mobile cards. */
  mobileCardStatusKey?: string;
  /** Optional: up to N priority keys to show collapsed in mobile card; rest behind expand. 0 = show all. */
  mobileVisibleFields?: number;
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
  mobileCardTitleKey,
  mobileCardStatusKey,
  mobileVisibleFields = 4,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(initialPinning || {});
  const [roleFilterValue, setRoleFilterValue] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [mobileDisplayMode, setMobileDisplayMode] = useState<'cards' | 'table'>('cards');
  // Mobile card expansion — separate from expandedRowId (which is the desktop detail row).
  const [mobileExpandedRowId, setMobileExpandedRowId] = useState<string | null>(null);

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

  // Resolve title and status column indices for mobile cards
  const titleColId = mobileCardTitleKey || (columns[0] as any)?.id || (columns[0] as any)?.accessorKey || '';
  const statusColId = mobileCardStatusKey || '';

  return (
    <div>
      {/* Toolbar: search, optional role filter, optional add-new */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3 md:mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-[var(--color-nexus-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-2 text-[13px] md:text-[14px] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-ink)]"
          />
        </div>
        {filterColumn && (
          <select
            value={roleFilterValue}
            onChange={e => {
              setRoleFilterValue(e.target.value);
              table.getColumn(filterColumn.id)?.setFilterValue(e.target.value || undefined);
            }}
            className="text-[13px] md:text-[14px] bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-[var(--radius-nexus-control)] px-3 py-2 text-[var(--color-nexus-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-nexus-primary-fixed)]"
          >
            <option value="">All {filterColumn.label}</option>
            {filterColumn.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {/* Mobile View Toggle (Cards vs Full Table) */}
        <div className="md:hidden flex items-center justify-end gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setMobileDisplayMode('cards')}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${
              mobileDisplayMode === 'cards'
                ? 'bg-[var(--color-nexus-primary)] text-white border-[var(--color-nexus-primary)]'
                : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] border-[var(--color-nexus-border)]'
            }`}
          >
            Cards
          </button>
          <button
            type="button"
            onClick={() => setMobileDisplayMode('table')}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${
              mobileDisplayMode === 'table'
                ? 'bg-[var(--color-nexus-primary)] text-white border-[var(--color-nexus-primary)]'
                : 'bg-[var(--color-nexus-surface-alt)] text-[var(--color-nexus-muted)] border-[var(--color-nexus-border)]'
            }`}
          >
            Table
          </button>
        </div>

        {onAddNew && (
          <button
            onClick={onAddNew}
            className="flex items-center gap-1.5 bg-[var(--color-nexus-primary)] hover:opacity-90 text-white text-[11px] md:text-[12px] font-semibold uppercase tracking-wider px-3 md:px-4 py-2 rounded-[var(--radius-nexus-control)] transition-opacity shrink-0"
          >
            <Plus size={14} /> {addNewLabel}
          </button>
        )}
      </div>

      {/* ========== DESKTOP / FULL TABLE VIEW ========== */}
      <div className={`overflow-x-auto nexus-card !shadow-none ${mobileDisplayMode === 'table' ? 'block' : 'hidden md:block'}`}>
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

      {/* ========== MOBILE CARD VIEW (hidden on desktop or when Table mode active) ========== */}
      <div className={`space-y-2 ${mobileDisplayMode === 'cards' ? 'block md:hidden' : 'hidden'}`}>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[var(--color-nexus-muted)]">{emptyMessage}</div>
        ) : rows.map(row => {
          const cells = row.getVisibleCells();
          const titleCell = cells.find(c => c.column.id === titleColId) || cells[0];
          const statusCell = statusColId ? cells.find(c => c.column.id === statusColId) : null;

          // Separate the remaining fields (excluding title & status which are shown in the card header)
          const otherCells = cells.filter(c => c !== titleCell && c !== statusCell);
          const isMobileExpanded = mobileExpandedRowId === row.id;
          const visibleCells = mobileVisibleFields > 0 ? otherCells.slice(0, mobileVisibleFields) : otherCells;
          const hiddenCells = mobileVisibleFields > 0 ? otherCells.slice(mobileVisibleFields) : [];
          const detail = renderRowDetail ? renderRowDetail(row.original) : null;

          return (
            <div
              key={row.id}
              className="bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-lg p-3 transition-colors"
            >
              {/* Card header: title + status */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-[13px] font-semibold text-[var(--color-nexus-ink)] min-w-0 truncate">
                  {titleCell && flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                </div>
                {statusCell && (
                  <div className="shrink-0">
                    {flexRender(statusCell.column.columnDef.cell, statusCell.getContext())}
                  </div>
                )}
              </div>

              {/* Visible fields */}
              <div className="space-y-1">
                {visibleCells.map(cell => {
                  const header = cell.column.columnDef.header;
                  const headerLabel = typeof header === 'string' ? header : cell.column.id.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                  return (
                    <div key={cell.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-[var(--color-nexus-muted)] shrink-0">{headerLabel}</span>
                      <span className="text-[var(--color-nexus-ink)] font-medium text-right min-w-0 truncate">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Hidden fields — expand to show */}
              {hiddenCells.length > 0 && (
                <>
                  {isMobileExpanded && (
                    <div className="space-y-1 mt-1 pt-1 border-t border-[var(--color-nexus-border)]/50">
                      {hiddenCells.map(cell => {
                        const header = cell.column.columnDef.header;
                        const headerLabel = typeof header === 'string' ? header : cell.column.id.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                        return (
                          <div key={cell.id} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="text-[var(--color-nexus-muted)] shrink-0">{headerLabel}</span>
                            <span className="text-[var(--color-nexus-ink)] font-medium text-right min-w-0 truncate">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    onClick={() => setMobileExpandedRowId(isMobileExpanded ? null : row.id)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--color-nexus-primary)] hover:text-[var(--color-nexus-primary)]/80"
                  >
                    <ChevronDown size={12} className={`transition-transform ${isMobileExpanded ? 'rotate-180' : ''}`} />
                    {isMobileExpanded ? 'Show less' : `${hiddenCells.length} more field${hiddenCells.length > 1 ? 's' : ''}`}
                  </button>
                </>
              )}

              {/* Inline detail (same as desktop row expansion) */}
              {detail && (
                <div className="mt-2 pt-2 border-t border-[var(--color-nexus-border)]/50 text-[12px] text-[var(--color-nexus-ink)]">
                  {detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination footer */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between mt-3 md:mt-4 text-[11px] md:text-[12px] text-[var(--color-nexus-muted)]">
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
