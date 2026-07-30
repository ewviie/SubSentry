"use client";

import { useEffect } from "react";

// Only fires for errors thrown by the root layout itself (font loading,
// providers, etc.) — everything else is caught by app/error.tsx or
// (app)/error.tsx. Must render its own <html>/<body> since it replaces the
// root layout when active.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100svh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <p style={{ fontWeight: 600 }}>Something went wrong</p>
          <p style={{ fontSize: "0.875rem", color: "#666" }}>
            Try again, or come back in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              background: "#111",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
