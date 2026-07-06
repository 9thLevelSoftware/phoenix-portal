// Re-exports the canonical shadcn/ui implementation.
// All call sites use the default 768 px breakpoint so the parameterised variant
// was redundant. The matchMedia-based implementation in use-mobile.ts is more
// efficient (reacts to CSS breakpoint changes rather than every resize event).
export { useIsMobile } from "../components/ui/use-mobile";
