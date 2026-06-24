import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Box, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import {
  DomainGroupNode,
  DomainNode,
  Level,
  LEVEL_LABEL,
  SubdomainNode,
  TaxonomyTree,
  TreeNode,
} from "../api/types";
import { TreeRow } from "./TreeRow";
import { DropZone } from "./DropZone";
import { LEVEL_COLOR } from "../theme/theme";

interface NodeMeta {
  node: TreeNode;
  level: Level;
  parentId: string | null;
  index: number;
}

const ROOT = "root";
const dropId = (childLevel: Level, parentId: string | null) => `drop:${childLevel}:${parentId ?? ROOT}`;

interface TreeExplorerProps {
  tree: TaxonomyTree;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (node: TreeNode) => void;
  onAddChild: (parentLevel: Level, parentId: string, parentName: string) => void;
  onReorder: (level: Level, parentId: string | null, orderedIds: string[]) => void;
  onMove: (level: Level, id: string, newParentId: string, newIndex: number) => void;
}

function ownerLine(node: TreeNode): string {
  const tech = node.technicalOwner ? ` · Tech: ${node.technicalOwner}` : "";
  return `Biz: ${node.businessOwner}${tech}`;
}

export function TreeExplorer({
  tree,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onAddChild,
  onReorder,
  onMove,
}: TreeExplorerProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Flat lookup of every node's level, parent and sibling index.
  const meta = useMemo(() => {
    const map = new Map<string, NodeMeta>();
    tree.forEach((g, gi) => {
      map.set(g.id, { node: g, level: "DomainGroup", parentId: null, index: gi });
      g.children.forEach((d, di) => {
        map.set(d.id, { node: d, level: "Domain", parentId: g.id, index: di });
        d.children.forEach((s, si) => {
          map.set(s.id, { node: s, level: "Subdomain", parentId: d.id, index: si });
          s.children.forEach((p, pi) => {
            map.set(p.id, { node: p, level: "DataProduct", parentId: s.id, index: pi });
          });
        });
      });
    });
    return map;
  }, [tree]);

  const siblingIds = (level: Level, parentId: string | null): string[] => {
    if (level === "DomainGroup") return tree.map((g) => g.id);
    const parent = parentId ? meta.get(parentId)?.node : undefined;
    if (!parent || !("children" in parent)) return [];
    return (parent.children as TreeNode[]).map((c) => c.id);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    const activeMeta = meta.get(activeIdStr);
    if (!activeMeta) return;
    const level = activeMeta.level;

    let targetParent: string | null;
    let targetIndex: number;

    if (overIdStr.startsWith("drop:")) {
      const [, childLevel, parentRaw] = overIdStr.split(":");
      if (childLevel !== level) return; // wrong tier
      targetParent = parentRaw === ROOT ? null : parentRaw;
      targetIndex = siblingIds(level, targetParent).filter((id) => id !== activeIdStr).length;
    } else {
      const overMeta = meta.get(overIdStr);
      if (!overMeta || overMeta.level !== level) return; // only same-tier targets
      targetParent = overMeta.parentId;
      targetIndex = overMeta.index;
    }

    if (targetParent === activeMeta.parentId) {
      const ids = siblingIds(level, activeMeta.parentId);
      const from = ids.indexOf(activeIdStr);
      const to = ids.indexOf(overIdStr);
      if (from === -1 || to === -1 || from === to) return;
      onReorder(level, activeMeta.parentId, arrayMove(ids, from, to));
    } else {
      if (level === "DomainGroup" || targetParent === null) return; // groups never move under a parent
      onMove(level, activeIdStr, targetParent, targetIndex);
    }
  };

  const activeNode = activeId ? meta.get(activeId)?.node : null;

  const renderDataProducts = (sub: SubdomainNode) => (
    <DropZone id={dropId("DataProduct", sub.id)}>
      <SortableContext items={sub.children.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        {sub.children.map((p) => (
          <TreeRow
            key={p.id}
            id={p.id}
            level="DataProduct"
            name={p.name}
            ownerLine={ownerLine(p)}
            depth={3}
            selected={selectedId === p.id}
            hasChildren={false}
            expanded={false}
            childCount={0}
            draggable
            canAddChild={false}
            onToggle={() => undefined}
            onSelect={() => onSelect(p)}
            onAddChild={() => undefined}
          />
        ))}
      </SortableContext>
    </DropZone>
  );

  const renderSubdomains = (domain: DomainNode) => (
    <DropZone id={dropId("Subdomain", domain.id)}>
      <SortableContext items={domain.children.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {domain.children.map((s) => (
          <Box key={s.id}>
            <TreeRow
              id={s.id}
              level="Subdomain"
              name={s.name}
              ownerLine={ownerLine(s)}
              depth={2}
              selected={selectedId === s.id}
              hasChildren={s.children.length > 0}
              expanded={expanded.has(s.id)}
              childCount={s.children.length}
              draggable
              canAddChild
              childLabel={LEVEL_LABEL.DataProduct}
              onToggle={() => onToggle(s.id)}
              onSelect={() => onSelect(s)}
              onAddChild={() => onAddChild("Subdomain", s.id, s.name)}
            />
            {expanded.has(s.id) ? renderDataProducts(s) : null}
          </Box>
        ))}
      </SortableContext>
    </DropZone>
  );

  const renderDomains = (group: DomainGroupNode) => (
    <DropZone id={dropId("Domain", group.id)}>
      <SortableContext items={group.children.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        {group.children.map((d) => (
          <Box key={d.id}>
            <TreeRow
              id={d.id}
              level="Domain"
              name={d.name}
              ownerLine={ownerLine(d)}
              depth={1}
              selected={selectedId === d.id}
              hasChildren={d.children.length > 0}
              expanded={expanded.has(d.id)}
              childCount={d.children.length}
              draggable
              canAddChild
              childLabel={LEVEL_LABEL.Subdomain}
              onToggle={() => onToggle(d.id)}
              onSelect={() => onSelect(d)}
              onAddChild={() => onAddChild("Domain", d.id, d.name)}
            />
            {expanded.has(d.id) ? renderSubdomains(d) : null}
          </Box>
        ))}
      </SortableContext>
    </DropZone>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <DropZone id={dropId("DomainGroup", null)}>
        <SortableContext items={tree.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {tree.map((g) => (
            <Box key={g.id} sx={{ mb: 0.5 }}>
              <TreeRow
                id={g.id}
                level="DomainGroup"
                name={g.name}
                ownerLine={ownerLine(g)}
                depth={0}
                selected={selectedId === g.id}
                hasChildren={g.children.length > 0}
                expanded={expanded.has(g.id)}
                childCount={g.children.length}
                draggable
                canAddChild
                childLabel={LEVEL_LABEL.Domain}
                onToggle={() => onToggle(g.id)}
                onSelect={() => onSelect(g)}
                onAddChild={() => onAddChild("DomainGroup", g.id, g.name)}
              />
              {expanded.has(g.id) ? renderDomains(g) : null}
            </Box>
          ))}
        </SortableContext>
      </DropZone>

      <DragOverlay>
        {activeNode ? (
          <Box
            sx={{
              px: 2,
              py: 1,
              borderRadius: 1.5,
              bgcolor: "#fff",
              boxShadow: 4,
              borderLeft: `3px solid ${LEVEL_COLOR[(meta.get(activeNode.id)?.level ?? "Domain") as Level]}`,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {activeNode.name}
            </Typography>
          </Box>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
