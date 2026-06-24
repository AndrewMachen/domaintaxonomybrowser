import { Box } from "@mui/material";
import { Level, LEVEL_LABEL } from "../api/types";
import { LEVEL_COLOR, LEVEL_TINT } from "../theme/theme";

export function LevelChip({ level, dense }: { level: Level; dense?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: dense ? 0.75 : 1,
        py: dense ? 0.125 : 0.25,
        borderRadius: 1,
        bgcolor: LEVEL_TINT[level],
        color: LEVEL_COLOR[level],
        fontSize: dense ? 11 : 12,
        fontWeight: 600,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
      }}
    >
      <Box
        component="span"
        sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: LEVEL_COLOR[level] }}
      />
      {LEVEL_LABEL[level]}
    </Box>
  );
}
