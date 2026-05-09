import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "pdfjs-dist"],
};

export default nextConfig;
