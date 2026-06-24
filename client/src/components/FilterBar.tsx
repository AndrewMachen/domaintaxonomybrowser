import {
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import AddIcon from "@mui/icons-material/Add";
import { Level, LEVELS, LEVEL_LABEL } from "../api/types";

export interface Filters {
  search: string;
  businessOwner: string;
  technicalOwner: string;
  level: Level | "all";
}

interface FilterBarProps {
  filters: Filters;
  businessOwners: string[];
  technicalOwners: string[];
  onChange: (filters: Filters) => void;
  onExport: () => void;
  onImport: () => void;
  onAddGroup: () => void;
}

export function FilterBar({
  filters,
  businessOwners,
  technicalOwners,
  onChange,
  onExport,
  onImport,
  onAddGroup,
}: FilterBarProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const activeCount =
    (filters.businessOwner ? 1 : 0) +
    (filters.technicalOwner ? 1 : 0) +
    (filters.level !== "all" ? 1 : 0);

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Search names and descriptions"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          sx={{ flex: 1, minWidth: 220 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Button startIcon={<AddIcon />} variant="contained" onClick={onAddGroup}>
          Domain group
        </Button>
        <Button startIcon={<FileUploadOutlinedIcon />} variant="outlined" onClick={onImport}>
          Import
        </Button>
        <Button startIcon={<FileDownloadOutlinedIcon />} variant="outlined" onClick={onExport}>
          Export
        </Button>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Level"
          value={filters.level}
          onChange={(e) => set({ level: e.target.value as Level | "all" })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All levels</MenuItem>
          {LEVELS.map((l) => (
            <MenuItem key={l} value={l}>
              {LEVEL_LABEL[l]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Business owner"
          value={filters.businessOwner}
          onChange={(e) => set({ businessOwner: e.target.value })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Anyone</MenuItem>
          {businessOwners.map((o) => (
            <MenuItem key={o} value={o}>
              {o}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Technical owner"
          value={filters.technicalOwner}
          onChange={(e) => set({ technicalOwner: e.target.value })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Anyone</MenuItem>
          {technicalOwners.map((o) => (
            <MenuItem key={o} value={o}>
              {o}
            </MenuItem>
          ))}
        </TextField>
        {activeCount > 0 ? (
          <Chip
            label={`Clear filters (${activeCount})`}
            onDelete={() => set({ businessOwner: "", technicalOwner: "", level: "all" })}
            onClick={() => set({ businessOwner: "", technicalOwner: "", level: "all" })}
            size="small"
            variant="outlined"
          />
        ) : null}
        <Box sx={{ flex: 1 }} />
      </Stack>
    </Stack>
  );
}
