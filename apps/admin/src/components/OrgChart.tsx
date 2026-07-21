import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';

interface OrgNode {
  id: number;
  name: string;
  role: string;
  designation: string;
  department: string;
  managerId: number | null;
}

interface TreeNode extends OrgNode {
  children: TreeNode[];
}

// Builds a tree from managerId. Anyone whose manager isn't set, or whose
// manager falls outside the caller's scope (see the org-chart endpoint's
// own reassignment of dangling references to null), becomes a root — so a
// tenant with a completely flat structure just renders every employee as a
// sibling at the top, never crashes on missing links. Cycle-guarded: if bad
// data somehow created a loop, a node already seen anywhere on its own
// ancestor path is cut off as a root instead of recursing forever.
function buildTree(nodes: OrgNode[]): TreeNode[] {
  const byId = new Map<number, OrgNode>(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<number, OrgNode[]>();
  const roots: OrgNode[] = [];
  for (const node of nodes) {
    if (node.managerId != null && byId.has(node.managerId)) {
      if (!childrenOf.has(node.managerId)) childrenOf.set(node.managerId, []);
      childrenOf.get(node.managerId)!.push(node);
    } else {
      roots.push(node);
    }
  }
  const build = (node: OrgNode, ancestors: Set<number>): TreeNode => {
    if (ancestors.has(node.id)) return { ...node, children: [] };
    const nextAncestors = new Set(ancestors).add(node.id);
    return { ...node, children: (childrenOf.get(node.id) || []).map((c) => build(c, nextAncestors)) };
  };
  return roots.map((r) => build(r, new Set()));
}

function TreeRow({ node, depth, expanded, toggle, onAssignManager, allNodes, canEdit }: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onAssignManager: (userId: number, managerId: number | null) => void;
  allNodes: OrgNode[];
  canEdit: boolean;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-[var(--color-nexus-surface-alt)] transition-colors"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggle(node.id)}
          className={`w-5 h-5 flex items-center justify-center shrink-0 ${hasChildren ? 'text-[var(--color-nexus-muted)]' : 'invisible'}`}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="w-7 h-7 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center justify-center text-[10px] font-bold shrink-0">
          {node.name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold text-[var(--color-nexus-ink)] truncate">{node.name}</span>
            <span className="text-[10px] text-[var(--color-nexus-muted)] shrink-0">{node.designation || node.role}</span>
          </div>
          {node.department && <span className="text-[10px] text-[var(--color-nexus-muted)]">{node.department}</span>}
        </div>
        {hasChildren && <span className="text-[9px] font-bold text-[var(--color-nexus-muted)] shrink-0">{node.children.length} report{node.children.length === 1 ? '' : 's'}</span>}
        {canEdit && (
          <select
            value={node.managerId ?? ''}
            onChange={(e) => onAssignManager(node.id, e.target.value ? Number(e.target.value) : null)}
            className="text-[10px] shrink-0 max-w-[140px] rounded-lg border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-1.5 py-1 focus:outline-none"
            title="Reporting manager"
          >
            <option value="">No manager (root)</option>
            {allNodes.filter((n) => n.id !== node.id).map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        )}
      </div>
      {isOpen && node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} onAssignManager={onAssignManager} allNodes={allNodes} canEdit={canEdit} />
      ))}
    </div>
  );
}

// Reporting-structure visualization built from users.managerId — an
// indented, collapsible tree rather than a box-and-line diagram, so it
// renders correctly at any depth/width without a charting library. Anyone
// with employee.edit can fix a wrong/missing manager assignment directly
// from here via the per-row dropdown, since that's the one thing standing
// between "the data exists" and "the chart is actually useful."
export default function OrgChart({ canEdit }: { canEdit: boolean }) {
  const token = localStorage.getItem('auth_token');
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/org-chart', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the org chart.');
      const fetched: OrgNode[] = Array.isArray(data.nodes) ? data.nodes : [];
      setNodes(fetched);
      // Start with every root (and the roots' first level) expanded so the
      // chart isn't a single collapsed line on first load.
      const tree = buildTree(fetched);
      setExpanded(new Set(tree.map((r) => r.id)));
    } catch (err: any) {
      setError(err.message || 'Could not load the org chart.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssignManager = async (userId: number, managerId: number | null) => {
    // Optimistic update — the dropdown itself is the confirmation UI, no
    // need to round-trip before reflecting the change.
    setNodes((prev) => prev.map((n) => (n.id === userId ? { ...n, managerId } : n)));
    try {
      const res = await fetch(`/api/tenant/employees/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ managerId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setError('Failed to update reporting manager — reloading.');
      refresh();
    }
  };

  if (loading) return <p className="text-xs text-[var(--color-nexus-muted)] text-center py-12">Loading org chart…</p>;

  return (
    <div className="nexus-card rounded-3xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-[var(--color-nexus-ink)] font-sans flex items-center gap-2"><Users size={17} /> Org Chart</h2>
      </div>
      <p className="text-xs text-[var(--color-nexus-muted)] mb-4">Reporting structure built from each employee's assigned manager.{canEdit ? ' Use the dropdown on any row to set or change who they report to.' : ''}</p>
      {error && <div className="mb-4 text-xs font-semibold text-[var(--color-nexus-error)] bg-[var(--color-nexus-error-soft)] rounded-xl px-4 py-2.5">{error}</div>}
      {tree.length === 0 ? (
        <p className="text-xs text-[var(--color-nexus-muted)] text-center py-8">No employees to show yet.</p>
      ) : (
        <div className="space-y-0.5">
          {tree.map((root) => (
            <TreeRow key={root.id} node={root} depth={0} expanded={expanded} toggle={toggle} onAssignManager={handleAssignManager} allNodes={nodes} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
