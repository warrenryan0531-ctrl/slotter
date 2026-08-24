// Edition flag (E5). One codebase, two products:
//  - agency: multi-tenant hub; a host/admin provisions businesses; no public signup; white-label.
//  - market: self-serve — anyone can sign up and run their own business; attribution on by default.
// Set SLOTTER_EDITION=market to build the market edition; anything else is the agency edition.
export type Edition = "agency" | "market";

export const EDITION: Edition = process.env.SLOTTER_EDITION === "market" ? "market" : "agency";
export const isMarket = (): boolean => EDITION === "market";
export const isAgency = (): boolean => EDITION === "agency";
