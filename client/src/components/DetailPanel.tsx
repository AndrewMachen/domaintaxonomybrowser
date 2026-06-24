import {
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useState } from "react";
import { CHILD_LEVEL, Level, LEVEL_LABEL, TreeNode } from "../api/types";
import { LevelChip } from "./LevelChip";
import { LEVEL_COLOR } from "../theme/theme";

interface DetailPanelProps {
  node: TreeNode | null;
  level: Level | null;
  childCount: number;
  busy: boolean;
  onRename: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddChild: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: "pre-wrap" }}>
        {value || "—"}
      </Typography>
    </Box>
  );
}

export function DetailPanel({
  node,
  level,
  childCount,
  busy,
  onRename,
  onEdit,
  onDelete,
  onAddChild,
}: DetailPanelProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setRenaming(false);
    setDraft(node?.name ?? "");
  }, [node?.id, node?.name]);

  if (!node || !level) {
    return (
      <Box sx={{ p: 4, color: "text.secondary", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <Typography variant="h6" sx={{ color: "text.primary" }}>
          Nothing selected
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, maxWidth: 260 }}>
          Pick an item from the taxonomy to see its details, or add a domain group to get started.
        </Typography>
      </Box>
    );
  }

  const childLevel = CHILD_LEVEL[level];
  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.name) onRename(trimmed);
    setRenaming(false);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 3, borderLeft: `4px solid ${LEVEL_COLOR[level]}` }}>
        <LevelChip level={level} />
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "flex-start", gap: 1 }}>
          {renaming ? (
            <Stack direction="row" spacing={1} sx={{ flex: 1 }} alignItems="center">
              <TextField
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                size="small"
                fullWidth
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
              <IconButton color="primary" onClick={commitRename} aria-label="Save name" disabled={busy}>
                <CheckIcon />
              </IconButton>
              <IconButton onClick={() => setRenaming(false)} aria-label="Cancel rename" disabled={busy}>
                <CloseIcon />
              </IconButton>
            </Stack>
          ) : (
            <>
              <Typography variant="h5" sx={{ fontWeight: 700, flex: 1, wordBreak: "break-word" }}>
                {node.name}
              </Typography>
              <Tooltip title="Rename">
                <IconButton size="small" onClick={() => setRenaming(true)} aria-label="Rename">
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      </Box>

      <Divider />

      <Stack spacing={2.5} sx={{ p: 3, flex: 1, overflowY: "auto" }}>
        <Field label="Description" value={node.description} />
        <Field label="Business owner" value={node.businessOwner} />
        <Field
          label={`Technical owner${level === "DomainGroup" ? " (optional)" : ""}`}
          value={node.technicalOwner ?? ""}
        />
        {childLevel ? (
          <Field label={`${LEVEL_LABEL[childLevel]}s`} value={String(childCount)} />
        ) : null}
        <Divider />
        <Stack direction="row" spacing={3}>
          <Field label="Created" value={new Date(node.createdAt).toLocaleString()} />
          <Field label="Updated" value={new Date(node.updatedAt).toLocaleString()} />
        </Stack>
      </Stack>

      <Box sx={{ p: 2, borderTop: 1, borderColor: "divider", display: "flex", gap: 1, flexWrap: "wrap" }}>
        {childLevel ? (
          <Button startIcon={<AddIcon />} onClick={onAddChild} disabled={busy} variant="outlined" size="small">
            Add {LEVEL_LABEL[childLevel]}
          </Button>
        ) : null}
        <Button startIcon={<EditIcon />} onClick={onEdit} disabled={busy} size="small">
          Edit
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          startIcon={<DeleteOutlineIcon />}
          onClick={onDelete}
          disabled={busy}
          color="error"
          size="small"
        >
          Delete
        </Button>
      </Box>
    </Box>
  );
}
