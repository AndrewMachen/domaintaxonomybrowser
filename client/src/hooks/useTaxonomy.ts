import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNode,
  deleteNode,
  fetchTree,
  importWorkbook,
  moveNode,
  reorderNodes,
  updateNode,
} from "../api/client";
import { Level, NodeFormValues } from "../api/types";

export const treeKey = ["tree"] as const;

export function useTree() {
  return useQuery({ queryKey: treeKey, queryFn: fetchTree });
}

export function useTreeMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: treeKey });

  const create = useMutation({
    mutationFn: (v: { level: Level; parentId: string | null; values: NodeFormValues }) =>
      createNode(v.level, v.parentId, v.values),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (v: { level: Level; id: string; values: Partial<NodeFormValues> }) =>
      updateNode(v.level, v.id, v.values),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (v: { level: Level; id: string }) => deleteNode(v.level, v.id),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (v: { level: Level; parentId: string | null; orderedIds: string[] }) =>
      reorderNodes(v.level, v.parentId, v.orderedIds),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: (v: { level: Level; id: string; newParentId: string; newIndex: number }) =>
      moveNode(v.level, v.id, v.newParentId, v.newIndex),
    onSuccess: invalidate,
  });

  const importFile = useMutation({
    mutationFn: (file: File) => importWorkbook(file),
    onSuccess: invalidate,
  });

  return { create, update, remove, reorder, move, importFile };
}
