import type { Metadata } from "next";
import { Big_Shoulders_Stencil, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const stencil = Big_Shoulders_Stencil({
  variable: "--font-stencil-face",
  subsets: ["latin"],
  weight: ["700", "900"],
});

export const metadata: Metadata = {
  title: "Deadbolt: the model said yes, the chain said no",
  description:
    "Talk AI agents out of real Solana devnet vaults. Then meet the on-chain lock no prompt can reach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${stencil.variable} antialiased`}>
      <body className="flex min-h-[100dvh] flex-col">
        <Providers>
          <Nav />
          <main className="flex flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
