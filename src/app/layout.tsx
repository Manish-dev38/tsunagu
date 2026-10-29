import type { Metadata } from "next";
import { Backdrop } from "@/components/backdrop";
import { ToastProvider } from "@/components/ui/toast";
import { TRPCProvider } from "@/trpc/provider";
import { Shell } from "./shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsunagu",
  description: "AI-native Gmail and Calendar",
};

// Applies the stored theme and sidebar state before first paint so nothing
// flashes; static trusted code, no interpolated input. localStorage is
// unavailable on the server, hence the try/catch and classes-on-<html>
// (suppressHydrationWarning). React mirrors both states after mount.
const INIT =
  'try{var m=localStorage.getItem("tsunagu-theme");var d=m==="dark"||((!m||m==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}' +
  'try{if(localStorage.getItem("tsunagu-sidebar-collapsed")==="true")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: INIT }} />
        <div className="backdrop">
          <Backdrop />
        </div>
        <TRPCProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
