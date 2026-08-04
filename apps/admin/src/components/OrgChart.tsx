import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Users, Search, Building2, UserCheck } from 'lucide-react';

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

function TreeRow({ node, depth, expanded, toggle, onAssignManager, uniqueManagers, canEdit }: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onAssignManager: (userId: number, managerId: number | null) => void;
  uniqueManagers: OrgNode[];
  canEdit: boolean;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-[var(--color-nexus-surface-alt)] transition-colors border border-transparent hover:border-[var(--color-nexus-border)]"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggle(node.id)}
          className={`w-5 h-5 flex items-center justify-center shrink-0 ${hasChildren ? 'text-[var(--color-nexus-muted)] hover:text-[var(--color-nexus-ink)] cursor-pointer' : 'invisible'}`}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="w-8 h-8 rounded-full bg-[var(--color-nexus-primary-fixed)] text-[var(--color-nexus-primary)] flex items-center justify-center text-xs font-bold shrink-0">
          {node.name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold text-[var(--color-nexus-ink)] truncate">{node.name}</span>
            <span className="text-[10px] font-mono text-[var(--color-nexus-secondary)]">EMP-{String(node.id).padStart(4, '0')}</span>
            <span className="text-[10px] text-[var(--color-nexus-muted)] shrink-0">{node.designation || node.role}</span>
          </div>
          {node.department && <span className="text-[10px] text-[var(--color-nexus-muted)] block">{node.department}</span>}
        </div>

        {hasChildren && <span className="text-[10px] font-mono font-bold text-[var(--color-nexus-muted)] px-2 py-0.5 rounded-full bg-[var(--color-nexus-surface-alt)] shrink-0">{node.children.length} report{node.children.length === 1 ? '' : 's'}</span>}

        {canEdit && (
          <select
            value={node.managerId ?? ''}
            onChange={(e) => onAssignManager(node.id, e.target.value ? Number(e.target.value) : null)}
            className="text-xs shrink-0 max-w-[200px] rounded-xl border border-[var(--color-nexus-border)] bg-[var(--color-nexus-surface)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-nexus-primary)] font-semibold text-[var(--color-nexus-ink)] cursor-pointer"
            title="Reporting manager"
          >
            <option value="">No manager (root)</option>
            {uniqueManagers.filter((n) => n.id !== node.id).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} (EMP-{String(n.id).padStart(4, '0')}) {n.department ? `— ${n.department}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      {isOpen && node.children.map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          toggle={toggle}
          onAssignManager={onAssignManager}
          uniqueManagers={uniqueManagers}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

export default function OrgChart({ canEdit }: { canEdit: boolean }) {
  const token = localStorage.getItem('auth_token');
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/org-chart', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the org chart.');
      const fetched: OrgNode[] = Array.isArray(data.nodes) ? data.nodes : [];
      setNodes(fetched);
      setExpanded(new Set(fetched.map((n) => n.id)));
    } catch (err: any) {
      setError(err.message || 'Could not load the org chart.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Deduplicate managers list by ID to eliminate duplicate entries in dropdowns
  const uniqueManagers = useMemo(() => {
    const map = new Map<number, OrgNode>();
    nodes.forEach((n) => {
      if (n.id && !map.has(n.id)) {
        map.set(n.id, n);
      }
    });
    return Array.from(map.values());
  }, [nodes]);

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const handleAssignManager = async (userId: number, managerId: number | null) => {
    try {
      const res = await fetch(`/api/tenant/employees/${userId}/manager`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ managerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update manager.');
      refresh();
    } catch (err: any) {
      alert(err.message || 'Failed to update manager.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[var(--color-nexus-ink)]">Organization Reporting Structure</h2>
          <p className="text-xs text-[var(--color-nexus-muted)]">Hierarchy automatically derived from employee reporting managers.</p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(expanded.size > 0 ? new Set() : new Set(nodes.map((n) => n.id)))}
          className="px-3 py-1.5 rounded-xl border border-[var(--color-nexus-border)] text-xs font-bold text-[var(--color-nexus-ink)] hover:bg-[var(--color-nexus-surface-alt)] cursor-pointer"
        >
          {expanded.size > 0 ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

      {loading ? (
        <div className="p-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">Loading org chart...</div>
      ) : tree.length === 0 ? (
        <div className="p-8 text-center text-xs font-mono text-[var(--color-nexus-muted)]">No org chart nodes found.</div>
      ) : (
        <div className="p-4 bg-[var(--color-nexus-surface)] border border-[var(--color-nexus-border)] rounded-2xl shadow-xs space-y-1">
          {tree.map((rootNode) => (
            <TreeRow
              key={rootNode.id}
              node={rootNode}
              depth={0}
              expanded={expanded}
              toggle={(id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              onAssignManager={handleAssignManager}
              uniqueManagers={uniqueManagers}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
