import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  return {
    title: "反应工程实验室｜理想反应器交互计算",
    description: "面向化学工程学习者的 BR、CSTR、PFR、PBR 交互式学习与计算工具。",
    openGraph: {
      title: "反应工程实验室",
      description: "从方程到工程判断：四类理想反应器交互计算。",
      images: [{ url: imageUrl, width: 1680, height: 945, alt: "反应工程实验室课程学习网页" }],
    },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
