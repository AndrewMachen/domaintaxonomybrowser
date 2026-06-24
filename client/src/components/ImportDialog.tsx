import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useRef, useState } from "react";
import { ImportSummary } from "../api/types";
import { templateUrl } from "../api/client";

interface ImportDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<ImportSummary>;
}

export function ImportDialog({ open, busy, onClose, onImport }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setSummary(null);
    setError(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setSummary(null);
    setError(null);
    try {
      const result = await onImport(file);
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const stat = (label: string, value: number, color?: string) => (
    <Box sx={{ textAlign: "center", flex: 1 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, color }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Import from Excel</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Upload an .xlsx workbook with one row per branch. Existing items are matched
            by name within their parent and updated in place; new items are created.
            Need the layout?{" "}
            <Link href={templateUrl()} download>
              Download the template
            </Link>
            .
          </Typography>

          <Box
            onClick={() => !busy && inputRef.current?.click()}
            sx={{
              border: "1.5px dashed",
              borderColor: "divider",
              borderRadius: 2,
              p: 4,
              textAlign: "center",
              cursor: busy ? "default" : "pointer",
              transition: "border-color 120ms",
              "&:hover": { borderColor: busy ? "divider" : "primary.main" },
            }}
          >
            <UploadFileIcon sx={{ fontSize: 36, color: "text.secondary" }} />
            <Typography sx={{ mt: 1, fontWeight: 600 }}>
              {fileName ?? "Choose a workbook"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              .xlsx files only
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </Box>

          {busy ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          {summary ? (
            <Box>
              <Divider sx={{ mb: 2 }} />
              <Stack direction="row" divider={<Divider orientation="vertical" flexItem />}>
                {stat("Created", summary.created, "#3F8F5B")}
                {stat("Updated", summary.updated, "#0E7C86")}
                {stat("Skipped", summary.skipped, summary.skipped ? "#C2791F" : undefined)}
                {stat("Errors", summary.errors.length, summary.errors.length ? "#C2362F" : undefined)}
              </Stack>
              {summary.errors.length ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Rows that need attention
                  </Typography>
                  <List dense sx={{ maxHeight: 180, overflowY: "auto", bgcolor: "rgba(194,54,47,0.04)", borderRadius: 1 }}>
                    {summary.errors.map((err, i) => (
                      <ListItem key={i}>
                        <ListItemText
                          primary={`Row ${err.row}`}
                          secondary={err.message}
                          primaryTypographyProps={{ fontWeight: 600, variant: "body2" }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              ) : (
                <Alert severity="success" sx={{ mt: 2 }}>
                  Import finished with no errors.
                </Alert>
              )}
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={busy} color="inherit">
          {summary ? "Done" : "Cancel"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
