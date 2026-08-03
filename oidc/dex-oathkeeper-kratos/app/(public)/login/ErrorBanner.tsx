"use client";

import { useState } from "react";

export function ErrorBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) {
    return null;
  }
  return (
    <div role="alert">
      <p>Something went wrong signing you in. Please try again.</p>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
