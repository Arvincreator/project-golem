import type { Metadata } from "next";
import { JetBrains_Mono, Manrope, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "../components/ThemeProvider";
import { I18nProvider } from "../components/I18nProvider";
import { OpsStyleProvider } from "../components/OpsStyleProvider";
import { ToastProvider } from "../components/ui/toast-provider";
import "./globals.css";

const fontSans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fontDisplay = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Project Golem Dashboard",
  description: "Web Dashboard for Project Golem v9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontDisplay.variable} ${fontMono.variable} antialiased`}
      >
        <ThemeProvider>
          <I18nProvider>
            <OpsStyleProvider>
              <ToastProvider>{children}</ToastProvider>
            </OpsStyleProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
