import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse",
  description: "Monitoramento de aplicações Node por heartbeat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
