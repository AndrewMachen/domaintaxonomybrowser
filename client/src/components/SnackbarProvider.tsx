import { Alert, Snackbar } from "@mui/material";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Severity = "success" | "error" | "info" | "warning";
interface Toast {
  message: string;
  severity: Severity;
}

interface SnackbarApi {
  notify: (message: string, severity?: Severity) => void;
}

const Ctx = createContext<SnackbarApi>({ notify: () => undefined });

export function useSnackbar() {
  return useContext(Ctx);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [open, setOpen] = useState(false);

  const notify = useCallback((message: string, severity: Severity = "success") => {
    setToast({ message, severity });
    setOpen(true);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={4000}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert
            onClose={() => setOpen(false)}
            severity={toast.severity}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Ctx.Provider>
  );
}
