import {
  Box,
  Button,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useState } from "react";
import { Level, LEVEL_LABEL, NodeFormValues, TECHNICAL_OWNER_REQUIRED } from "../api/types";
import { emptyForm, FieldErrors, hasErrors, validateNode } from "../api/validation";
import { RequestError } from "../api/client";
import { LevelChip } from "./LevelChip";
import { LEVEL_COLOR } from "../theme/theme";

export interface DrawerState {
  mode: "create" | "edit";
  level: Level;
  parentId: string | null;
  parentName?: string;
  initial?: NodeFormValues;
  nodeId?: string;
}

interface NodeFormDrawerProps {
  state: DrawerState | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: NodeFormValues) => Promise<void>;
}

export function NodeFormDrawer({ state, busy, onClose, onSubmit }: NodeFormDrawerProps) {
  const [values, setValues] = useState<NodeFormValues>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (state) {
      setValues(state.initial ?? emptyForm);
      setErrors({});
    }
  }, [state]);

  if (!state) return null;
  const { level, mode } = state;
  const techRequired = TECHNICAL_OWNER_REQUIRED[level];

  const setField = (key: keyof NodeFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };

  const submit = async () => {
    const found = validateNode(level, values);
    if (hasErrors(found)) {
      setErrors(found);
      return;
    }
    try {
      await onSubmit(values);
    } catch (e) {
      if (e instanceof RequestError && e.fields) {
        setErrors(e.fields as FieldErrors);
      }
    }
  };

  return (
    <Drawer anchor="right" open onClose={busy ? undefined : onClose}>
      <Box sx={{ width: { xs: "100vw", sm: 420 }, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box
          sx={{
            px: 3,
            py: 2,
            borderBottom: 1,
            borderColor: "divider",
            borderLeft: `4px solid ${LEVEL_COLOR[level]}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="h6">
              {mode === "create" ? "New" : "Edit"} {LEVEL_LABEL[level]}
            </Typography>
            {state.parentName ? (
              <Typography variant="caption" color="text.secondary">
                in {state.parentName}
              </Typography>
            ) : null}
          </Box>
          <IconButton onClick={onClose} disabled={busy} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Box>

        <Stack spacing={2.5} sx={{ p: 3, flex: 1, overflowY: "auto" }}>
          <Box>
            <LevelChip level={level} />
          </Box>
          <TextField
            label="Name"
            value={values.name}
            onChange={setField("name")}
            error={!!errors.name}
            helperText={errors.name}
            required
            autoFocus
            fullWidth
          />
          <TextField
            label="Description"
            value={values.description}
            onChange={setField("description")}
            error={!!errors.description}
            helperText={errors.description}
            required
            multiline
            minRows={3}
            fullWidth
          />
          <TextField
            label="Business owner"
            value={values.businessOwner}
            onChange={setField("businessOwner")}
            error={!!errors.businessOwner}
            helperText={errors.businessOwner}
            required
            fullWidth
          />
          <Tooltip
            title={techRequired ? "" : "Optional for domain groups"}
            placement="top-start"
          >
            <TextField
              label="Technical owner"
              value={values.technicalOwner}
              onChange={setField("technicalOwner")}
              error={!!errors.technicalOwner}
              helperText={errors.technicalOwner ?? (techRequired ? "" : "Optional at this level")}
              required={techRequired}
              fullWidth
            />
          </Tooltip>
        </Stack>

        <Box sx={{ px: 3, py: 2, borderTop: 1, borderColor: "divider", display: "flex", gap: 1.5, justifyContent: "flex-end" }}>
          <Button onClick={onClose} disabled={busy} color="inherit">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} variant="contained">
            {mode === "create" ? "Create" : "Save changes"}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
