import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mql.matches)

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }

    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])

  return !!isMobile
}
