import { useSessionContext } from "./StwrdProvider.js";
export function useSession() { return useSessionContext(); }
export function useUser() { return useSession().user; }
export function useOrganization() { return useSession().organization; }
