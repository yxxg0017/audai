import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 视觉对话助手",
  description: "面向实时语音和摄像头画面理解的 AI 对话应用。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
