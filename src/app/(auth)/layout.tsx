"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AuthSettings } from "@/components/auth-settings";


export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
       <AuthSettings />
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6 text-primary"
            >
              <path d="M12 22a10 10 0 1 0-10-10" />
              <path d="M12 18a6 6 0 1 0 0-12" />
              <path d="M12 14a2 2 0 1 0 0-4" />
              <path d="M22 12a10 10 0 0 0-10-10" />
              <path d="M12 12a6 6 0 0 1 6-6" />
              <path d="M12 12a2 2 0 0 1 2-2" />
            </svg>
            <span className="text-xl">QuorumFlow</span>
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
