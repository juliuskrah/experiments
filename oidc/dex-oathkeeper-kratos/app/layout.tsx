import type { ReactNode } from "react";
import { SessionNotice } from "@/app/components/SessionNotice";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionNotice />
        {children}
      </body>
    </html>
  );
}
