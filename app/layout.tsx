import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wax — Omnichannel workspace",
  description:
    "Calls, conference meetings and every social channel in one shared inbox.",
};

/**
 * Restores the saved theme and sidebar preference before the first paint, so
 * neither flashes the other state on load.
 */
const clientScript = `try{var t=localStorage.getItem("wax-theme");if(t==="dark"||t==="night"||t==="light"){document.documentElement.dataset.theme=t}var s=localStorage.getItem("wax-sidebar");if(s==="hidden"||s==="shown"){document.documentElement.dataset.sidebar=s}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="night"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
