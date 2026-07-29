"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { system } from "../../theme";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ThemeProvider
        attribute="class"
        disableTransitionOnChange
        defaultTheme="dark"
        forcedTheme="dark"
      >
        {children}
      </ThemeProvider>
    </ChakraProvider>
  );
}
