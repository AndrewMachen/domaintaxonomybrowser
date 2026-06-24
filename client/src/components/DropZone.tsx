import { useDroppable } from "@dnd-kit/core";
import { Box } from "@mui/material";

/** A drop region wrapping a parent's child list so cross-parent drops resolve. */
export function DropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: 1.5,
        outline: isOver ? "2px dashed rgba(14,124,134,0.5)" : "2px dashed transparent",
        outlineOffset: -2,
        transition: "outline-color 120ms",
      }}
    >
      {children}
    </Box>
  );
}
