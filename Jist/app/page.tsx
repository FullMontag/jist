import Link from "next/link";

export default function Home({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Jist</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>Your personal CFO — weekly financial digests from your inbox.</p>

      {searchParams.connected === "true" && (
        <div style={{ background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#2e7d32" }}>
          Gmail connected successfully! You'll receive your first digest next Sunday.
        </div>
      )}

      {searchParams.error && (
        <div style={{ background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#c62828" }}>
          Error: {searchParams.error}
        </div>
      )}

      <Link
        href="/api/auth/gmail"
        style={{
          display: "inline-block",
          background: "#1a1a1a",
          color: "#fff",
          padding: "12px 24px",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Connect Gmail
      </Link>
    </main>
  );
}
