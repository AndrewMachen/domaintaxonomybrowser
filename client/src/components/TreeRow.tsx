import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Level, LEVEL_LABEL } from "../api/types";
import { LEVEL_COLOR } from "../theme/theme";

interface TreeRowProps {
  id: string;
  level: Level;
  name: string;
  ownerLine: string;
  depth: number;
  selected: boolean;
  hasChildren: boolean;
  expanded: boolean;
  childCount: number;
  draggable: boolean;
  canAddChild: boolean;
  childLabel?: string;
  onToggle: () => void;
  onSelect: () => void;
  onAddChild: () => void;
}

export function TreeRow({
  id,
  level,
  name,
  ownerLine,
  depth,
  selected,
  hasChildren,
  expanded,
  childCount,
  draggable,
  canAddChild,
  childLabel,
  onToggle,
  onSelect,
  onAddChild,
}: TreeRowProps) {
  const sortable = useSortable({ id, data: { level }, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        pr: 1,
        pl: `${depth * 20 + 8}px`,
        minHeight: 40,
        borderRadius: 1.5,
        cursor: "pointer",
        position: "relative",
        opacity: isDragging ? 0.4 : 1,
        bgcolor: selected ? "rgba(14,124,134,0.10)" : "transparent",
        "&:hover": { bgcolor: selected ? "rgba(14,124,134,0.14)" : "rgba(27,36,48,0.04)" },
        "&:hover .row-actions": { opacity: 1 },
        "&::before": {
          content: '""',
          position: "absolute",
          left: `${depth * 20}px`,
          top: 6,
          bottom: 6,
          width: 3,
          borderRadius: 2,
          bgcolor: LEVEL_COLOR[level],
          opacity: selected ? 1 : 0.55,
        },
      }}
      onClick={onSelect}
    >
      {draggable ? (
        <Box
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          sx={{ display: "flex", color: "text.disabled", cursor: "grab", "&:active": { cursor: "grabbing" } }}
          aria-label={`Drag ${name}`}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
      ) : (
        <Box sx={{ width: 20 }} />
      )}

      {hasChildren ? (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
          sx={{ p: 0.25 }}
        >
          {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
      ) : (
        <Box sx={{ width: 28 }} />
      )}

      <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {name}
          {hasChildren ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
              {childCount}
            </Typography>
          ) : null}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {ownerLine}
        </Typography>
      </Box>

      <Box className="row-actions" sx={{ opacity: 0, transition: "opacity 120ms", display: "flex" }}>
        {canAddChild ? (
          <Tooltip title={`Add ${childLabel ?? LEVEL_LABEL[level]}`}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild();
              }}
              aria-label={`Add ${childLabel}`}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
}
