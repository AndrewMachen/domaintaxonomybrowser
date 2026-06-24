import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Paper,
  Typography,
} from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import { useMemo, useState } from "react";
import { FilterBar, Filters } from "./components/FilterBar";
import { TreeExplorer } from "./components/TreeExplorer";
import { DetailPanel } from "./components/DetailPanel";
import { DrawerState, NodeFormDrawer } from "./components/NodeFormDrawer";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ImportDialog } from "./components/ImportDialog";
import { useTree, useTreeMutations } from "./hooks/useTaxonomy";
import { collectOwners, filterTree } from "./hooks/filterTree";
import { useSnackbar } from "./components/SnackbarProvider";
import {
  CHILD_LEVEL,
  Level,
  LEVEL_LABEL,
  NodeFormValues,
  TaxonomyTree,
  TreeNode,
} from "./api/types";
import { exportUrl } from "./api/client";
import { RequestError } from "./api/client";

interface Located {
  node: TreeNode;
  level: Level;
  childCount: number;
}

function locate(tree: TaxonomyTree, id: string): Located | null {
  for (const g of tree) {
    if (g.id === id) return { node: g, level: "DomainGroup", childCount: g.children.length };
    for (const d of g.children) {
      if (d.id === id) return { node: d, level: "Domain", childCount: d.children.length };
      for (const s of d.children) {
        if (s.id === id) return { node: s, level: "Subdomain", childCount: s.children.length };
        for (const p of s.children) {
          if (p.id === id) return { node: p, level: "DataProduct", childCount: 0 };
        }
      }
    }
  }
  return null;
}

const emptyFilters: Filters = { search: "", businessOwner: "", technicalOwner: "", level: "all" };

export default function App() {
  const { data: tree, isLoading, isError, error } = useTree();
  const m = useTreeMutations();
  const { notify } = useSnackbar();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Located | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const fullTree = tree ?? [];
  const owners = useMemo(() => collectOwners(fullTree), [fullTree]);
  const filtered = useMemo(() => filterTree(fullTree, filters), [fullTree, filters]);

  const expanded = useMemo(() => {
    const set = new Set(manualExpanded);
    filtered.expand.forEach((id) => set.add(id));
    return set;
  }, [manualExpanded, filtered.expand]);

  const selected = selectedId ? locate(fullTree, selectedId) : null;

  const busy =
    m.create.isPending ||
    m.update.isPending ||
    m.remove.isPending ||
    m.reorder.isPending ||
    m.move.isPending;

  const toggle = (id: string) =>
    setManualExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const failure = (e: unknown, fallback: string) => {
    const msg = e instanceof RequestError ? e.message : fallback;
    notify(msg, "error");
  };

  const openCreate = (level: Level, parentId: string | null, parentName?: string) =>
    setDrawer({ mode: "create", level, parentId, parentName });

  const openCreateChild = (parentLevel: Level, parentId: string, parentName: string) => {
    const childLevel = CHILD_LEVEL[parentLevel];
    if (childLevel) openCreate(childLevel, parentId, parentName);
  };

  const openEdit = () => {
    if (!selected) return;
    const { node, level } = selected;
    setDrawer({
      mode: "edit",
      level,
      parentId: null,
      nodeId: node.id,
      initial: {
        name: node.name,
        description: node.description,
        businessOwner: node.businessOwner,
        technicalOwner: node.technicalOwner ?? "",
      },
    });
  };

  const submitDrawer = async (values: NodeFormValues) => {
    if (!drawer) return;
    if (drawer.mode === "create") {
      const created = await m.create.mutateAsync({ level: drawer.level, parentId: drawer.parentId, values });
      notify(`${LEVEL_LABEL[drawer.level]} created`);
      const id = (created as { id?: string })?.id;
      if (id) {
        setSelectedId(id);
        if (drawer.parentId) setManualExpanded((p) => new Set(p).add(drawer.parentId!));
      }
    } else if (drawer.nodeId) {
      await m.update.mutateAsync({ level: drawer.level, id: drawer.nodeId, values });
      notify("Changes saved");
    }
    setDrawer(null);
  };

  const rename = async (name: string) => {
    if (!selected) return;
    try {
      await m.update.mutateAsync({ level: selected.level, id: selected.node.id, values: { name } });
      notify("Renamed");
    } catch (e) {
      failure(e, "Rename failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = (await m.remove.mutateAsync({
        level: deleteTarget.level,
        id: deleteTarget.node.id,
      })) as { descendantsRemoved: number };
      const extra = res.descendantsRemoved
        ? ` and ${res.descendantsRemoved} nested item${res.descendantsRemoved === 1 ? "" : "s"}`
        : "";
      notify(`Deleted ${deleteTarget.node.name}${extra}`);
      if (selectedId === deleteTarget.node.id) setSelectedId(null);
    } catch (e) {
      failure(e, "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  const reorder = async (level: Level, parentId: string | null, orderedIds: string[]) => {
    try {
      await m.reorder.mutateAsync({ level, parentId, orderedIds });
    } catch (e) {
      failure(e, "Reorder failed");
    }
  };

  const move = async (level: Level, id: string, newParentId: string, newIndex: number) => {
    try {
      await m.move.mutateAsync({ level, id, newParentId, newIndex });
      notify(`${LEVEL_LABEL[level]} moved`);
      setManualExpanded((p) => new Set(p).add(newParentId));
    } catch (e) {
      failure(e, "Move failed");
    }
  };

  const runImport = async (file: File) => {
    const summary = await m.importFile.mutateAsync(file);
    const total = summary.created + summary.updated;
    if (summary.errors.length) {
      notify(`Imported with ${summary.errors.length} error${summary.errors.length === 1 ? "" : "s"}`, "warning");
    } else {
      notify(`Imported ${total} item${total === 1 ? "" : "s"}`);
    }
    return summary;
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box sx={{ bgcolor: "#1B2430", color: "#fff", px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
        <AccountTreeIcon sx={{ color: "#3C97A0" }} />
        <Typography sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>
          Data Mesh Taxonomy
        </Typography>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", ml: 0.5 }}>
          domain group → domain → subdomain → data product
        </Typography>
      </Box>

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          <FilterBar
            filters={filters}
            businessOwners={owners.business}
            technicalOwners={owners.technical}
            onChange={setFilters}
            onExport={() => {
              window.open(exportUrl(), "_blank");
            }}
            onImport={() => setImportOpen(true)}
            onAddGroup={() => openCreate("DomainGroup", null)}
          />

          <Box sx={{ borderTop: 1, borderColor: "divider", display: "flex", minHeight: "62vh" }}>
            <Box sx={{ flex: { xs: 1, md: "1 1 58%" }, borderRight: { md: 1 }, borderColor: "divider", p: 1.5, overflowY: "auto", maxHeight: "78vh" }}>
              {isLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                  <CircularProgress />
                </Box>
              ) : isError ? (
                <Alert severity="error" sx={{ m: 2 }}>
                  Couldn't load the taxonomy. Is the API running on port 4000?{" "}
                  {error instanceof Error ? error.message : ""}
                </Alert>
              ) : fullTree.length === 0 ? (
                <EmptyState onAdd={() => openCreate("DomainGroup", null)} />
              ) : filtered.tree.length === 0 ? (
                <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>
                  <Typography variant="h6" sx={{ color: "text.primary" }}>No matches</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Nothing fits the current search and filters.
                  </Typography>
                </Box>
              ) : (
                <TreeExplorer
                  tree={filtered.tree}
                  selectedId={selectedId}
                  expanded={expanded}
                  onToggle={toggle}
                  onSelect={(n) => setSelectedId(n.id)}
                  onAddChild={openCreateChild}
                  onReorder={reorder}
                  onMove={move}
                />
              )}
            </Box>

            <Box sx={{ flex: { xs: 1, md: "1 1 42%" }, display: { xs: selected ? "block" : "none", md: "block" }, maxHeight: "78vh", overflowY: "auto" }}>
              <DetailPanel
                node={selected?.node ?? null}
                level={selected?.level ?? null}
                childCount={selected?.childCount ?? 0}
                busy={busy}
                onRename={rename}
                onEdit={openEdit}
                onDelete={() => selected && setDeleteTarget(selected)}
                onAddChild={() => {
                  if (selected) openCreateChild(selected.level, selected.node.id, selected.node.name);
                }}
              />
            </Box>
          </Box>
        </Paper>
      </Container>

      <NodeFormDrawer state={drawer} busy={busy} onClose={() => setDrawer(null)} onSubmit={submitDrawer} />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget ? LEVEL_LABEL[deleteTarget.level] : ""}?`}
        destructive
        confirmLabel="Delete"
        busy={m.remove.isPending}
        message={
          deleteTarget ? (
            <>
              <strong>{deleteTarget.node.name}</strong> will be permanently removed.
              {deleteTarget.childCount > 0 ? (
                <Box component="span" sx={{ display: "block", mt: 1, color: "error.main" }}>
                  This also deletes everything nested beneath it.
                </Box>
              ) : null}
            </>
          ) : null
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ImportDialog
        open={importOpen}
        busy={m.importFile.isPending}
        onClose={() => setImportOpen(false)}
        onImport={runImport}
      />
    </Box>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Box sx={{ p: 6, textAlign: "center" }}>
      <AccountTreeIcon sx={{ fontSize: 48, color: "text.disabled" }} />
      <Typography variant="h6" sx={{ mt: 1 }}>
        Build your taxonomy
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        Start with a domain group, then nest domains, subdomains and data products beneath it.
      </Typography>
      <Box
        component="button"
        onClick={onAdd}
        sx={{
          border: "none",
          cursor: "pointer",
          bgcolor: "primary.main",
          color: "#fff",
          px: 2.5,
          py: 1,
          borderRadius: 2,
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Add domain group
      </Box>
    </Box>
  );
}
