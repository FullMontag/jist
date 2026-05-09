import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jist — Personal CFO",
  description: "Weekly financial digests from your inbox",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f5f5" }}>{children}</body>
    </html>
  );
}
